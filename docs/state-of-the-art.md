# State of the art: designing, verifying and running agentic state machines

*Survey date: 25 September 2026. The claims about other tools were checked against their
documentation, repositories or arXiv abstracts on that date (links in [Sources](#sources)). Items
marked "not verified" come from general knowledge and were not re-checked.*

LLM agents are increasingly built as explicit control flows — graphs, state machines,
workflows — around non-deterministic model calls. This document looks at the tools in the
domains that such a system touches, from design to operation, and at where nuxmv-editor-js fits:
what it has that the others do not, and what the others do that it does not.

## 1. Summary

The individual pieces all exist:
- visual state-machine editors (Stately, Workflow Studio);
- agent frameworks with live graph views (LangGraph Studio, the Burr UI, Microsoft's DevUI);
- model checkers (nuXmv, SPIN, TLC, UPPAAL, PRISM, Storm);
- runtime-verification tools (NuRV, RTAMT);
- research prototypes that check agent graphs or constrain agents with temporal rules (Agentproof,
  TraceFix, AgentSpec, ProbGuard, Agent-C).

No tool we found combines them on one artifact. nuxmv-editor-js takes a diagram and, from that
single source:
1. verifies it with a temporal-logic model checker, and replays counterexamples on the drawing;
2. generates an implementation that refuses the transitions the model does not have;
3. monitors the same properties at run time;
4. shows the running system live on the diagram;
5. checks recorded runs against the model;
6. adds probabilities;
7. exports to or imports from agent frameworks.

Its limits: it verifies the *control flow*, not what the LLM says within a state. Its models are
flat, finite-state and discrete-time. And it is a design and verification tool, not a production
orchestrator (it hands that to Temporal, LangGraph or Burr).

### Capability matrix

✓ = supported; ◐ = partly (see the domain sections); — = not supported, as far as the sources
show.

| | Visual design | Temporal-logic model checking | Counterexample on the diagram | Runtime enforces the model | Runtime monitors of the same properties | Live view of the running system | Recorded-trace conformance | Probabilistic analysis | Import from / export to agent frameworks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **nuxmv-editor-js** | ✓ | ✓ nuXmv (LTL, CTL, past LTL) | ✓ | ✓ Python | ✓ built-in past-time + NuRV | ✓ editor + Jupyter | ✓ JSONL / OpenTelemetry | ✓ built-in + PRISM export | ✓ LangGraph, CrewAI, Mermaid, XState in; XState, LangGraph, Burr, Temporal out |
| transitions + transitions-gui | ◐ diagrams (graphviz / mermaid) | — | — | ✓ | — | ✓ browser (gui) | — | — | — |
| python-statemachine | ◐ diagrams, Jupyter rendering | — | — | ✓ (guards, validators) | — | ◐ Jupyter | — | — | — |
| pydantic-graph | ◐ mermaid | — | — | ✓ edges from type hints | — | — | — | — | — |
| XState + Stately | ✓ editor | — | — | ✓ | — | ✓ Inspector | — | — | ◐ exports code, JSON, Mermaid |
| LangGraph + Studio | ◐ Studio visualises | — | — | ✓ | — | ✓ Studio | — | — | ◐ graph JSON, Mermaid |
| Apache Burr | ◐ tracking UI | — | — | ✓ | — | ✓ tracking UI | — | — | ◐ OpenTelemetry |
| CrewAI Flows / LlamaIndex Workflows | ◐ HTML plot | — | — | ✓ | — | ◐ (LlamaIndex debugger UI) | — | — | — |
| Microsoft Agent Framework | ◐ DevUI | — | — | ✓ | — | ✓ DevUI | — | — | — |
| Temporal | — | — | — | ✓ durable, deterministic replay | — | ◐ web UI of histories | ◐ replay of histories | — | — |
| AWS Step Functions Workflow Studio | ✓ | — | — | ✓ | — | ◐ execution view | — | — | ◐ JSON / YAML |
| nuXmv / NuSMV alone | — | ✓ | — (text traces) | — | — | — | — | — | — |
| TLA+ / TLC, SPIN, UPPAAL | ◐ UPPAAL | ✓ | ◐ UPPAAL simulator, text traces | — | — | — | — | ◐ UPPAAL SMC | — |
| PRISM / Storm | — | ✓ probabilistic | — | — | — | — | — | ✓ | — |
| NuRV | — | ✓ (nuXmv inside) | — | — | ✓ generates monitors | — | ◐ offline RV | — | — |
| RTAMT | — | — | — | — | ✓ STL monitors | — | ✓ offline | — | — |
| Agentproof (research) | — | ◐ DFA policies on extracted graphs | — | — | ✓ runtime over events | — | ✓ event traces | — | ✓ extracts LangGraph, CrewAI, AutoGen, ADK |
| TraceFix (research) | — | ✓ TLA+ / TLC | — | ✓ runtime monitor | ✓ | — | — | — | — |
| AgentSpec / ProbGuard / Agent-C / ShieldAgent (research) | — | ◐ (Agent-C: SMT) | — | ✓ runtime enforcement | ✓ | — | — | ◐ ProbGuard: learned DTMC | — |
| NeMo Guardrails / Invariant Guardrails | — | — | — | ✓ flows / policies | ✓ | — | ◐ Invariant: trace policies | — | — |

*The rows for TLA+/TLC, SPIN and UPPAAL, and the Temporal and Step Functions execution views, come
from general knowledge; the other rows come from the sources checked for this survey.*

## 2. The domains

### 2.1 State-machine libraries and visual editors

- **pytransitions/transitions.** The reference Python FSM library. It has `conditions` and
  `unless` guards and before/after and enter/exit callbacks. `GraphMachine` draws diagrams with
  pygraphviz, graphviz or mermaid, and example Jupyter notebooks show graph editing. Its companion
  **transitions-gui** is a standalone browser application (Tornado, WebSocket, Cytoscape.js). It
  shows a running machine live and lets you fire an event by clicking an edge. It is not a Jupyter
  widget, and neither project verifies temporal properties.
- **python-statemachine.** Guards (conditions) and validators, Graphviz and Mermaid diagrams, and
  automatic rendering of machine instances as diagrams in JupyterLab.
- **pydantic-graph** (Pydantic AI). Graph edges come from the return type hints of each node's
  `run`, so the edges are enforced by construction. It renders Mermaid diagrams and persists
  state. The model *is* the code, so there is no separate specification to verify.
- **XState v5 + Stately.** A visual statechart editor with design and simulate modes, with export
  to JSON, JavaScript/TypeScript and Mermaid. The **Stately Inspector** shows running actors live,
  mostly for XState and front-end code, though it also works with back-end code and other state
  management. Statecharts support hierarchy and parallel regions, which nuxmv-editor-js does not.
  It has no temporal-logic verification.
- **AWS Step Functions Workflow Studio.** Drag-and-drop design that generates Amazon States
  Language, with JSON/YAML export and an execution view.

**nuxmv-editor-js compared.** Its editor is simpler than Stately: flat states, no hierarchy or
parallel regions. What it adds is model checking of the drawing, with counterexamples replayed on
it, and a generated runtime whose monitors re-check the verified properties. Its XState export
and import mean a machine can move between the two.

### 2.2 Agent orchestration frameworks

- **LangGraph.** A `StateGraph` with conditional edges. Checkpointers persist the graph state and
  enable human-in-the-loop, time travel and fault tolerance. Interrupts pause for external input.
  **LangGraph Studio** (in LangSmith) is an agent IDE for visualising, inspecting and time-travel
  debugging runs.
- **Apache Burr** (incubating, from DAGWorks). Agents are explicit state machines of actions and
  transitions, with a tracking UI, OpenTelemetry support and pluggable persisters.
- **CrewAI Flows.** `@start`, `@listen` and `@router` decorators; `plot()` writes an interactive
  HTML view.
- **LlamaIndex Workflows.** Event-driven steps; `draw_all_possible_flows` writes an HTML view,
  and a WorkflowServer adds a debugger UI.
- **Microsoft Agent Framework.** The successor to Semantic Kernel and AutoGen: workflows with
  superstep checkpoints, human-in-the-loop requests, and **DevUI**, a sample application for
  visualising and debugging agents and workflows. The earlier Semantic Kernel Process Framework is
  marked experimental.
- **Temporal.** Durable execution. Workflow code must be deterministic so it can be replayed from
  its event history; interaction with the outside world, including LLM calls, goes into
  activities. Signals and queries let people and other systems interact with a running workflow.
- **Visual agent builders**: n8n, Langflow, Dify, Flowise *(not verified)*. Low-code graphs of LLM
  steps, without formal verification.

**nuxmv-editor-js compared.** These frameworks *run* agents. None of them states or checks
temporal properties of the graph: that a human approves every release, that retries are bounded,
that a state is reachable. nuxmv-editor-js does not replace them. It verifies the control flow and
then exports it: to LangGraph (a node per state), Burr (an action per state), Temporal (decisions
as activities, human steps as signals) or XState. In each export every move goes through the
verified transition table. The importers read existing LangGraph (JSON, Mermaid, source), CrewAI
Flow, Mermaid and XState graphs, so agents that are already built can be verified. In return,
those frameworks provide what nuxmv-editor-js leaves to them: persistence, scale, retries, tool
integrations, deployment.

### 2.3 Model checkers and specification languages

- **nuXmv / NuSMV** (FBK). Symbolic model checking of LTL, CTL and invariants over finite and
  infinite-state models, with BDD, BMC and IC3 engines. This is the engine nuxmv-editor-js uses.
- **TLA+ / TLC and Apalache**, **SPIN / Promela**, **UPPAAL** (timed automata, with a graphical
  editor, simulator and statistical model checking) *(not verified)*. All mature. They are textual
  (UPPAAL excepted) and none generates agent code or runtime monitors.

**nuxmv-editor-js compared.** It makes a model checker usable by people who design agents. They
draw or type the machine and write properties from templates (termination, human gates, step
order, reachability). Counterexamples are replayed on the drawing instead of read as text.
Expressiveness is below TLA+ or UPPAAL: no clocks, no processes, no unbounded data.

### 2.4 Formal methods for LLM agents (research, 2024–2026)

- **Agentproof** (arXiv 2603.20356, March 2026). Extracts graphs from LangGraph, CrewAI, AutoGen
  and Google ADK. It checks structure, and checks temporal policies written in a DSL compiled to
  DFAs, both statically (graph × DFA) and at run time over event traces. On 18 workflows built by
  the authors, 27% had structural defects and 55% violated a human-gate policy. The authors say
  this is *not* a prevalence study. It is the closest work to nuxmv-editor-js's check-then-monitor
  design; it has no editor, no counterexample replay and no LTL/CTL model checker.
- **TraceFix** (arXiv 2605.07935, May 2026). An LLM writes a PlusCal coordination protocol and
  repairs it with TLC counterexamples. The verified process bodies are compiled into per-agent
  prompts and run under a runtime monitor.
- **AgentSpec** (arXiv 2503.18666). A rule language of trigger, predicate and enforcement for
  runtime constraints. It reports preventing unsafe executions in over 90% of code-agent cases.
- **ProbGuard**, first titled Pro2Guard (arXiv 2508.00500). Learns a discrete-time Markov chain
  from execution traces and intervenes when the predicted probability of reaching an unsafe state
  passes a threshold.
- **Agent-C** (arXiv 2512.23738). A temporal-constraint DSL translated to first-order logic, with
  SMT checks and constrained decoding during generation.
- **ShieldAgent** (arXiv 2503.22738). Verifiable safety-policy reasoning with action-based
  probabilistic rule circuits.
- **Formal-LLM** (arXiv 2402.00798). An automaton constrains how the LLM generates its plan.
- **VeriPlan** (arXiv 2502.17898, CHI 2025). End-user planning in which LLM-translated rules are
  checked by a model checker.
- **StateFlow** (arXiv 2403.11322). Models LLM task-solving as state machines; reports higher
  success than ReAct at lower cost.

**nuxmv-editor-js compared.** It is a tool rather than a research prototype. Its guardrails are
explicit, visual and verified before deployment, and the same formulas are enforced at run time.
What it does *not* do, and the research above does, is constrain what the LLM *produces*: tokens
(Agent-C) or tool arguments (AgentSpec). It does offer the legal next events for constrained
decoding: `allowed_events()` as a tool `enum`, and `Rejected.as_feedback()` for the model.

### 2.5 Runtime verification, guardrails and observability

- **NuRV** (FBK). Runtime verification built on nuXmv, online and offline, with monitors *under
  assumptions*: the model is used to reach verdicts early. It generates monitors in C, C++, Java,
  Python, Common Lisp, Prolog, LLVM IR and FMU. It is free for academic use.
- **RTAMT.** A Python library for Signal Temporal Logic, online and offline, discrete and dense
  time. Its online monitors take the bounded-future fragment and translate it to past-time STL.
- **NeMo Guardrails** (Colang flows for dialogue and guardrails), **Invariant Guardrails** (a
  policy language over agent traces) and **Guardrails AI** *(not verified)*: policy layers around
  LLM calls.
- **OpenTelemetry GenAI semantic conventions.** Now in their own repository, still in development.
  They define agent and workflow spans (`invoke_agent`, `create_agent`, `invoke_workflow`) and tool
  spans (`execute_tool`).

**nuxmv-editor-js compared.**
- Its built-in monitors cover invariants and G(present/past) formulas, compiled with the classic
  incremental construction.
- The NuRV integration adds full-LTL monitors under the model's assumptions. It generates the NuRV
  script, runs NuRV, compiles the C, and works around two issues in NuRV 2.0.0's Python wrapper: the
  library path and an extra argument.
- `enable_tracing()` emits spans with `fsm.*` attributes, and the conformance checker reads them
  back. The spans do not yet follow the GenAI conventions' names.
- Guardrail frameworks such as NeMo or Invariant filter content; nuxmv-editor-js constrains the
  *process*. The two are complementary.

### 2.6 Probabilistic model checking

**PRISM** (DTMC, CTMC, MDP, PTA, POMDP; PCTL, CSL, LTL, rewards) and **Storm** (PRISM, JANI and
explicit inputs; Python bindings) are the reference tools. ProbGuard and VeriPlan apply
probabilistic models to agents.

**nuxmv-editor-js compared.** The `prob` annotations turn a diagram into a Markov chain over
configurations. The editor computes reachability probabilities (bounded and unbounded), expected
steps and expected visits, and exports the chain to PRISM/Storm for everything else. Its values
match PRISM 4.10.1 in the test suite. It has no MDP (nondeterminism *and* probability), no
continuous time, and no probabilities learned from traces as ProbGuard does. Learning them from
recorded runs would be a natural next step.

### 2.7 Notebooks and live visualisation

- **ipycytoscape**: a Cytoscape.js widget for JupyterLab and the classic notebook.
- **python-statemachine**: renders a machine as a diagram in JupyterLab.
- **transitions**: example notebooks. Live views otherwise live outside notebooks:
  transitions-gui, the Stately Inspector, LangGraph Studio, the Burr UI, DevUI.

**nuxmv-editor-js compared.** Generated machines display as SVG in any notebook, and as a live
anywidget/Cytoscape.js widget that follows every transition. The editor itself can follow and
drive a running process over a two-way link, where transitions-gui drives a *transitions* machine
from its page.

## 3. Why it matters for LLM agents

- **Agents fail in the ways model checking finds.** The MAST taxonomy (arXiv 2503.13657; 1,600+
  traces, 7 frameworks) counts step repetition and unawareness of termination or stopping
  conditions among the most frequent failures. The current version reports 15.7% and 12.4%; v2
  reported 17.14% and 9.82%. Both are loop and termination defects that nuXmv proves or refutes.
- **Human gates get skipped.** In July 2025 Replit's agent ran destructive commands during a code
  freeze and deleted production data (AI Incident Database, incident 1152). A past-time guardrail
  such as "production changes only right after human approval" is checked by nuXmv and enforced at
  the transition by the generated runtime.
- **Practitioners call for explicit control flow.** Anthropic's *Building effective agents*
  (December 2024) prefers workflows for predictability, with stopping conditions such as a maximum
  number of iterations and checkpoints for human feedback. *12-factor agents* (factor 8) says to
  "own your control flow".
- **Regulation asks for oversight.** Article 14 of the EU AI Act requires high-risk systems to be
  effectively overseeable by people. 14(4)(e) includes the ability to "interrupt the system through
  a 'stop' button or a similar procedure that allows the system to come to a halt in a safe state".
  This applies to high-risk uses, not all agents. A verified model with human-gate properties,
  runtime monitors, conformance checks and a live view gives evidence that the oversight exists and
  works.

## 4. What nuxmv-editor-js brings, and what it lacks

**Brings, in one tool, from one diagram:**
1. Visual and textual design (Langium grammar, Cytoscape.js), with layouts that minimise
   crossings.
2. Model checking with nuXmv: LTL, CTL, past-time LTL and invariants, with BDD, BMC and IC3, over
   finite models with guards and bounded data. Counterexamples are replayed on the diagram.
3. Probabilistic analysis of the same diagram, and PRISM/Storm export.
4. A generated Python runtime that only takes verified transitions, with rejection policies for
   LLM feedback and escalation, and monitors of the verified properties: built-in past-time, and
   full LTL through NuRV.
5. Jupyter notebooks with a live widget; a two-way live link to running processes; OpenTelemetry
   spans.
6. Trace conformance of recorded runs (JSON Lines or OpenTelemetry), replayed on the diagram.
7. Hypothesis property-based tests that check an implementation's hooks against the model.
8. Exports to XState, LangGraph, Burr and Temporal; imports from LangGraph, CrewAI, Mermaid and
   XState.
9. Tests that check the pieces agree with each other in both directions: nuXmv, the TypeScript
   semantics, the generated Python, NuRV and PRISM.

**Lacks:**
- *Structure*: no hierarchical or parallel states (Stately has statecharts), no multiple modules or
  processes, no clocks or dense time (UPPAAL, RTAMT).
- *Data*: only bounded integers, booleans and enumerations; large domains run into state explosion,
  as all explicit and BDD methods do.
- *Scope of the guarantee*: verification covers the model, not what the LLM does inside a state.
  The implementation matches the model only as far as the generated runtime, tests and conformance
  checks enforce it.
- *Probabilistic modelling*: no MDPs, and no probabilities learned from traces.
- *Operations*: no persistence, scheduling or distribution (these are delegated to Temporal,
  LangGraph and Burr); NuRV is licensed separately; importing Python source is best effort.
- *Standards*: the tracing does not yet use the OpenTelemetry GenAI span names.

## 5. When to use what

| Need | Use |
| --- | --- |
| Run an agent in production (persistence, retries, scale) | LangGraph, Burr, Temporal, Microsoft Agent Framework |
| Visual statecharts with hierarchy and parallel regions | XState + Stately |
| Filter or shape LLM content | NeMo Guardrails, Invariant, Agent-C / AgentSpec (research) |
| Prove properties of the agent's control flow, and keep them true in code and in operation | nuxmv-editor-js, then export to the runtime of your choice |
| Timed or concurrent protocols | UPPAAL, TLA+ / TLC, SPIN |
| Rich probabilistic models (MDPs, CTMCs) | PRISM, Storm (nuxmv-editor-js exports to them) |

## Sources

All checked on 25 September 2026 unless marked otherwise.

- transitions — https://github.com/pytransitions/transitions ; transitions-gui — https://github.com/pytransitions/transitions-gui
- python-statemachine — https://python-statemachine.readthedocs.io/en/latest/diagram.html , /guards.html
- pydantic-graph — https://pydantic.dev/docs/ai/graph/graph/ ; persistence: https://github.com/pydantic/pydantic-ai/blob/main/docs/graph.md
- LangGraph — https://docs.langchain.com/oss/python/langgraph/persistence , /interrupts ; LangGraph Studio — https://docs.langchain.com/langsmith/studio
- Apache Burr — https://github.com/apache/burr , https://burr.apache.org/
- Stately — https://stately.ai/docs/inspector , https://stately.ai/docs/studio , https://stately.ai/docs/export-as-code
- Temporal — https://docs.temporal.io/workflows , https://docs.temporal.io/encyclopedia/workflow-message-passing
- CrewAI Flows — https://docs.crewai.com/en/concepts/flows
- LlamaIndex Workflows — https://developers.llamaindex.ai/python/framework/understanding/workflows/ , https://developers.llamaindex.ai/python/llamaagents/workflows/drawing/
- Microsoft Agent Framework — https://learn.microsoft.com/en-us/agent-framework/overview/ , /concepts/workflows/ , DevUI: /integrations/by-component/ui/devui/
- Semantic Kernel Process Framework — https://learn.microsoft.com/en-us/semantic-kernel/frameworks/process/process-framework
- AWS Step Functions Workflow Studio — https://docs.aws.amazon.com/step-functions/latest/dg/workflow-studio.html
- nuXmv — https://nuxmv.fbk.eu ; NuRV — https://es-static.fbk.eu/tools/nurv/
- PRISM — https://www.prismmodelchecker.org/ ; Storm — https://www.stormchecker.org/
- RTAMT — https://github.com/nickovic/rtamt ; ipycytoscape — https://github.com/cytoscape/ipycytoscape
- NeMo Guardrails — https://docs.nvidia.com/nemo/guardrails/latest/ ; Invariant — https://github.com/invariantlabs-ai/invariant
- OpenTelemetry GenAI conventions — https://github.com/open-telemetry/semantic-conventions-genai (agent spans: docs/gen-ai/gen-ai-agent-spans.md; tool spans: docs/gen-ai/gen-ai-spans.md)
- Agentproof — https://arxiv.org/abs/2603.20356 ; TraceFix — https://arxiv.org/abs/2605.07935 ; AgentSpec — https://arxiv.org/abs/2503.18666 ; ProbGuard / Pro2Guard — https://arxiv.org/abs/2508.00500 ; Agent-C — https://arxiv.org/abs/2512.23738 ; ShieldAgent — https://arxiv.org/abs/2503.22738 ; Formal-LLM — https://arxiv.org/abs/2402.00798 ; VeriPlan — https://arxiv.org/abs/2502.17898 ; StateFlow — https://arxiv.org/abs/2403.11322
- MAST — https://arxiv.org/abs/2503.13657 (percentages from https://arxiv.org/html/2503.13657 and https://arxiv.org/html/2503.13657v2)
- Replit incident — https://incidentdatabase.ai/cite/1152/
- EU AI Act, Article 14 — https://artificialintelligenceact.eu/article/14/
- Anthropic, Building effective agents — https://www.anthropic.com/engineering/building-effective-agents
- 12-factor agents, factor 8 — https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-08-own-your-control-flow.md
- Not verified in this survey: SPIN (https://spinroot.com), UPPAAL (https://uppaal.org), TLA+ (https://lamport.azurewebsites.net/tla/tla.html), Apalache (https://apalache-mc.org), n8n, Langflow, Dify, Flowise, Guardrails AI.
