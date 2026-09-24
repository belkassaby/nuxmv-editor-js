# nuxmv-editor-js

A browser-based diagram editor for the [nuXmv](https://nuxmv.fbk.eu) model checker. Draw a directed
finite state transition system, or type it, label its states with atoms, write LTL, CTL or invariant
properties, and check them with nuXmv. When a property is false, the counterexample is replayed step
by step on the diagram.

![Counterexample of the mutual exclusion liveness property replayed on the diagram](docs/counterexample.png)

This project re-implements **JungToNusmv**, the tool described in the MSc dissertation
*"A Java Graphical User Interface for the NuSMV Model Checker"* (B. El Kassaby, University of
Liverpool, 2007), with a current web stack. It also implements the dissertation's "future
developments" and removes the limitations listed in its evaluation chapter.

| 2007 (JungToNusmv)                                 | Now (nuxmv-editor-js)                                              |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| Java Swing GUI                                     | Angular 22 (standalone components, signals, zoneless)              |
| JUNG 1.7 graph editor                              | Cytoscape.js + cytoscape-edgehandles                               |
| `GraphMapping` / `NusmvFileWriter` (string arrays) | Langium 4 grammar (`.nxd`), typed diagram model, nuXmv generator   |
| `attributeData.txt`, edited by hand                | Attribute table (the planned Fig. 4.6 interface); the old file format can still be imported |
| `Runtime.exec` of NuSMV 2.4                        | Node.js/Express backend that runs nuXmv 2.x                        |
| Output copied into a text area                     | Verdicts parsed per property; counterexamples shown on the graph   |

## Features

- **Two synchronised views.** The text editor (CodeMirror, with Langium parsing and validation) and
  the drawing board (Cytoscape.js) edit the same model. Changes in one appear in the other.
- **Diagram editing.** Select/move, add-state and add-transition modes, self-loops, box selection,
  zoom and pan, automatic layout, and PNG export. Initial states have a double border and dead-end
  states a dashed one.
- **Atoms and attributes.** Boolean, enumerated and integer-range attributes, edited in a
  state × attribute table. A value left unset lets nuXmv choose any value in that state.
- **Properties.** `LTLSPEC`, `CTLSPEC` and `INVARSPEC` (optionally named), plus `FAIRNESS` and
  `JUSTICE` constraints. Langium checks their syntax, rejects unknown names, and rejects CTL
  operators in LTL properties and the reverse.
- **Verification.** Three nuXmv engines: BDD (exact), bounded model checking, and IC3. Each result
  is matched to its property even though nuXmv reports them in its own order.
- **Counterexamples.** A lasso trace is shown both on the graph and as a table of variable values,
  with the steps and the start of the loop marked. You can step through it or play it.
- **Simulation.** Walk through the model by clicking successor states, or take random steps.
- **Files.** Save and open `.nxd` files, export the `.smv` model, import the legacy
  `attributeData.txt` format, and load four built-in examples.

### Limitations of the original tool, now removed

| Dissertation, §5.2 / §5.3                                   | Here                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| Only the first state created can be initial                 | Any number of initial states: `init(state) := {s0, s2}`       |
| Dead-end states produce `state = s0 : {};` (parser error)   | Dead ends stutter (`state = s0 : s0;`) and a warning is shown |
| Attribute interface not connected                           | Attribute table plus per-state inspector                      |
| No open/save                                                | `.nxd` text format (it also keeps the layout)                 |
| LTL only                                                    | LTL, CTL, invariants, fairness                                |
| Tool tips show only the state name                          | Tool tips show all attribute values of the state              |
| No simulation, no graphical counterexample ("NusmvToJung")  | Both are implemented                                          |
| Must restart the tool to try another diagram                | New/Open/Examples at any time                                 |
| Hard-coded paths                                            | `NUXMV_PATH` environment variable                             |

## Architecture

```
packages/
├── language/   @nuxmv-editor/language  (runs in the browser and in Node)
│   ├── src/state-diagram.langium       grammar of the .nxd language
│   ├── src/state-diagram-validator.ts  types, names, dead ends, LTL/CTL checks
│   ├── src/model.ts                    DiagramModel: the shared data structure
│   ├── src/serializer.ts               DiagramModel -> .nxd text
│   ├── src/smv-generator.ts            DiagramModel -> nuXmv model
│   ├── src/nuxmv-output.ts             nuXmv output -> verdicts + traces
│   └── src/legacy-attributes.ts        import of JungToNusmv attributeData.txt
├── server/     @nuxmv-editor/server    Node.js + Express
│   ├── src/nuxmv-runner.ts             spawns nuXmv (BDD / BMC / IC3), timeouts
│   ├── src/app.ts                      REST API, serves the built UI
│   └── src/cli.ts                      `nxd generate|check`
└── app/        @nuxmv-editor/app       Angular UI
    └── src/app/
        ├── diagram-store.ts            signals store keeping text and diagram in sync
        ├── text-editor/                CodeMirror + Langium diagnostics
        ├── diagram-canvas/             Cytoscape.js editor, trace highlighting
        ├── attribute-table/  inspector/  properties-panel/  trace-panel/  output-panel/
        └── nuxmv-api.ts                calls the backend
```

```
 .nxd text ──Langium parse/validate──▶ DiagramModel ◀──edits── Cytoscape diagram
     ▲                                     │
     └────────────── serialize ────────────┤
                                           ▼
                                  nuXmv model (.smv) ──POST /api/verify──▶ Node ──spawn──▶ nuXmv
                                                                              │
                  trace on diagram ◀── verdicts + counterexamples ◀── parse ◀─┘
```

## Getting started

### 1. Install nuXmv

nuXmv is not included in this repository. Its license is separate from this project's (free for
non-commercial and academic use). Download it from <https://nuxmv.fbk.eu/download.html>, extract it,
and point `NUXMV_PATH` at the binary:

```sh
export NUXMV_PATH=/path/to/nuXmv-2.2.0-linux64/bin/nuXmv
```

<details>
<summary>macOS: <code>Library not loaded: /opt/local/lib/libxml2.16.dylib</code></summary>

The macOS build is linked against MacPorts libraries. Either install them with MacPorts
(`sudo port install libxml2 gmp libedit`), or use the Homebrew versions through a small wrapper
script:

```sh
brew install libxml2 gmp libedit
cat > ~/bin/nuxmv <<EOF
#!/bin/sh
DYLD_FALLBACK_LIBRARY_PATH="$(brew --prefix libxml2)/lib:$(brew --prefix gmp)/lib:$(brew --prefix libedit)/lib" \\
  exec /path/to/nuXmv-2.2.0-macos64/usr/local/bin/nuXmv "\$@"
EOF
chmod +x ~/bin/nuxmv
export NUXMV_PATH=~/bin/nuxmv
```
</details>

### 2. Build and run

Requires Node.js 20.19 or later.

```sh
npm install
npm run build
NUXMV_PATH=/path/to/nuXmv npm start      # http://127.0.0.1:3000
```

For development with live reload (Angular on :4200, API proxied to :3000):

```sh
NUXMV_PATH=/path/to/nuXmv npm run dev    # http://localhost:4200
```

Everything except running nuXmv (editing, validation, model generation, simulation) happens in the
browser.

| Variable                 | Default                       | Meaning                                       |
| ------------------------ | ----------------------------- | --------------------------------------------- |
| `NUXMV_PATH`             | `nuXmv` (looked up on `PATH`) | nuXmv executable                              |
| `PORT` / `HOST`          | `3000` / `127.0.0.1`          | Listening address (loopback by default)       |
| `NUXMV_TIMEOUT_MS`       | `60000`                       | nuXmv is killed after this time               |
| `NUXMV_MAX_OUTPUT_BYTES` | `5000000`                     | Output kept per run                           |
| `STATIC_DIR`             | `packages/app/dist/app/browser` | Built UI served on `/`                      |

## The `.nxd` language

```
// Resource monitor (Huth & Ryan, Logic in Computer Science, ch. 3)
diagram ResourceMonitor

attributes {
  status  : { ready, busy };     // enumeration
  request : boolean;
  level   : 0..3;                // integer range
}

initial state s0 "idle" { status = ready, request = TRUE } at (120, 100)
state s1 { status = busy, request = TRUE }       // `at` (the layout) is optional
state s2 { status = ready }                       // request unset: any value

s0 -> s1 : "request";            // optional transition label (documentation only)
s1 -> s0;
s2 -> s0;

FAIRNESS request;
LTLSPEC G (request -> F status = ready);
CTLSPEC NAME can_reset := AG EF state = s0;
INVARSPEC level <= 3;
```

- Expressions use nuXmv syntax: `! & | xor xnor -> <->`, `= != < > <= >=`, `+ - * / mod`, LTL
  `G F X U V`, CTL `AG AF AX EG EF EX A[p U q] E[p U q]`. The variable `state` holds the name of
  the current state.
- `--`, `//` and `/* */` comments are accepted.
- Keywords and temporal operators (`state`, `at`, `G`, `F`, `X`, `U`, `V`, `A`, `E`, …) are
  reserved and cannot be used as names.

The generator writes the "sequential style" model of the dissertation (§2.2.2): a `state`
variable, one `init`, a `next(state)` case per state, and one invariant assignment per attribute:

```
MODULE main
VAR
    state : {s0, s1, s2, s3};
    status : {ready, busy};
    request : boolean;
ASSIGN
    init(state) := s0;
    next(state) := case
        state = s0 : {s1, s3};
        state = s1 : {s1, s3};
        ...
        TRUE : state;
    esac;
    status := case
        state = s0 : ready;
        state = s1 : busy;
        ...
    esac;
LTLSPEC
    G (request -> F status = ready);
```

## Command line

```sh
npx nxd generate examples/mutex.nxd -o mutex.smv
NUXMV_PATH=/path/to/nuXmv npx nxd check examples/mutex.nxd --engine bdd
#   true        CTLSPEC safety := AG !(p1 = c & p2 = c)
#   false       LTLSPEC liveness := G (p1 = t -> F p1 = c)
#                 1.1: state = s0
#                 1.2: state = s1
#                 1.3: state = s3  <- loop starts
#   ...
```

Exit codes: `0` if every property holds, `3` if a property is false, `1` on errors.

## REST API

| Method | Path          | Body                                                                                            |
| ------ | ------------- | ----------------------------------------------------------------------------------------------- |
| GET    | `/api/health` | returns nuXmv availability and version                                                          |
| POST   | `/api/verify` | `{ "model": "<smv>" }` or `{ "diagram": "<nxd>" }`, plus `engine` (`bdd`/`bmc`/`ic3`) and `bound` |

The response contains the raw `stdout`/`stderr` and the parsed `results` (property, verdict, trace),
`errors` and `warnings`.

## Tests

```sh
npm test                                     # language, server (stand-in nuXmv) and UI unit tests
NUXMV_PATH=/path/to/nuXmv npm test -w @nuxmv-editor/server   # also runs every example on real nuXmv, with all engines
```

## Examples

`examples/` contains the resource monitor (§2.2.2), the Appendix A walkthrough together with its
`attributeData.txt`, the [HR04] mutual exclusion model (its liveness property fails), and the
Clarke–Grumberg–Peled microwave oven (its property holds only under fairness).

## License

MIT, see [LICENSE](LICENSE). nuXmv is a separate product with its own license.
