import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, generateNotebook, generatePython, parseDiagram, Semantics } from '../src/index.js';

const python = ['python3', 'python'].find(cmd => spawnSync(cmd, ['--version']).status === 0);

async function generate(id: string) {
    const { model } = await parseDiagram(EXAMPLES.find(e => e.id === id)!.source);
    return { model, py: await generatePython(model) };
}

describe('Python generator', () => {
    it('derives events from transition labels and keeps the verified table', async () => {
        const { py, model } = await generate('agent-tool-approval');
        expect(py.className).toBe('ToolApprovalFSM');
        expect(py.moduleName).toBe('tool_approval_fsm');
        expect(py.transitions.map(t => t.event)).toEqual(['TOOL_CALL', 'ANSWER', 'APPROVE', 'DENY', 'TOOL_RESPONSE']);
        // The stutter self-loop of the final state is not an event of the running system.
        expect(py.transitions).toHaveLength(model.transitions.length - 1);
        expect(py.terminalStates).toEqual(['done']);
        expect(py.code).toContain('(State.APPROVAL_REQUIRED, Event.APPROVE): State.USING_TOOL,');
    });

    it('names unlabelled transitions after their target and disambiguates clashes', async () => {
        const { model } = await parseDiagram('initial state a\nstate b\nstate c\na -> b : "go";\na -> c : "go";\nb -> a;\nc -> a;');
        const py = await generatePython(model);
        expect(py.transitions.map(t => t.event)).toEqual(['GO__TO_B', 'GO__TO_C', 'TO_A', 'TO_A']);
    });

    it('monitors invariants and G(past-time) properties only', async () => {
        const { py } = await generate('agent-coding-loop');
        const monitored = py.monitors.filter(m => m.monitored).map(m => m.name);
        expect(monitored).toContain('human_decides_release');
        expect(monitored).toContain('retry_budget');
        expect(py.monitors.find(m => m.name === 'can_go_live')?.reason).toMatch(/CTL/);
        expect(py.monitors.find(m => m.name === 'bounded_rework')?.reason).toMatch(/future/);
    });
});

describe.skipIf(!python)('generated Python (runs with the system Python)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nxd-py-'));
    const run = (script: string) => execFileSync(python!, ['-c', script], { cwd: dir, encoding: 'utf8' });

    it.each(EXAMPLES.map(e => [e.id]))('%s: compiles, rejects illegal events, and random walks never trip a monitor', async id => {
        const { py } = await generate(id);
        writeFileSync(join(dir, `${py.moduleName}.py`), py.code);
        const out = run(`
import random, ${py.moduleName} as m
fsm = m.${py.className}()
illegal = [e for e in m.Event if e not in fsm.allowed_events()]
if illegal:
    try:
        fsm.send(illegal[0]); raise SystemExit("illegal event accepted")
    except m.InvalidTransition:
        pass
rng = random.Random(3)
for _ in range(15):
    fsm = m.${py.className}()
    for _ in range(150):
        ev = fsm.allowed_events()
        if not ev: break
        fsm.send(rng.choice(ev))
assert fsm._repr_svg_().startswith("<svg")
print("ok")
`);
        expect(out.trim()).toBe('ok');
    });

    it('agrees with the TypeScript semantics on a model with guards and data', async () => {
        const { model } = await parseDiagram(EXAMPLES.find(e => e.id === 'agent-retry-data')!.source);
        const py = await generatePython(model);
        writeFileSync(join(dir, `${py.moduleName}.py`), py.code);
        const sem = await Semantics.of(model);
        const eventOf = new Map(py.transitions.map(t => [t.index, t.event]));
        for (const seed of [1, 2, 3, 4, 5]) {
            let config = sem.initialConfigurations()[0];
            let x = seed;
            const steps: Array<{ event: string; enabled: string[]; variables: Record<string, unknown> }> = [];
            for (let k = 0; k < 60; k++) {
                const enabled = sem.enabled(config).filter(i => eventOf.has(i));
                if (enabled.length === 0) break;
                x = (x * 48271) % 2147483647;
                const i = enabled[x % enabled.length];
                config = sem.fire(i, config);
                steps.push({ event: eventOf.get(i)!, enabled: enabled.map(j => eventOf.get(j)!).sort(), variables: config.variables });
            }
            writeFileSync(join(dir, 'steps.json'), JSON.stringify(steps));
            const out = run(`
import json, ${py.moduleName} as m
fsm = m.${py.className}()
bad = 0
for s in json.load(open("steps.json")):
    if sorted(e.value for e in fsm.allowed_events()) != s["enabled"]: bad += 1
    fsm.send(s["event"])
    if fsm.variables != s["variables"]: bad += 1
print(bad)
`);
            expect(out.trim()).toBe('0');
        }
    });

    it('monitors catch a design that skips the human release decision', async () => {
        const { model } = await generate('agent-coding-loop');
        model.transitions.push({ source: 'prompting', target: 'deploying', label: 'hotfix' });
        model.name = 'Hotfix';
        const py = await generatePython(model);
        writeFileSync(join(dir, 'hotfix_fsm.py'), py.code);
        const out = run(`
import hotfix_fsm as m
fsm = m.HotfixFSM(strict=False)
fsm.send("HOTFIX")
print(sorted(x.name for x in fsm.monitors if x.violated_at is not None))
try:
    m.HotfixFSM().send("HOTFIX")
except m.PropertyViolation as e:
    print("strict:", "human_decides_release" in str(e))
`);
        expect(out).toContain("'human_decides_release'");
        expect(out).toContain("'deploys_the_merged_change'");
        expect(out).toContain('strict: True');
    });

    it('past-time operators follow their semantics step by step', async () => {
        const { model } = await parseDiagram(`
            diagram Past
            attributes { p : boolean; }
            initial state a { p = FALSE }
            state b { p = TRUE }
            a -> b : "up"; b -> a : "down"; a -> a : "stay";
            LTLSPEC NAME once := G (p -> O p);
            LTLSPEC NAME prev := G (Y p -> !p);
            LTLSPEC NAME hist := G (H !p | O p);
            LTLSPEC NAME since := G (p -> (p S p));
            LTLSPEC NAME weak := G (Z TRUE);
        `);
        const py = await generatePython(model);
        expect(py.monitors.every(m => m.monitored)).toBe(true);
        writeFileSync(join(dir, 'past_fsm.py'), py.code);
        // "prev" says p never holds twice in a row, which is true of this diagram.
        const out = run(`
import past_fsm as m
fsm = m.PastFSM()
fsm.replay(["stay", "up", "down", "up", "down", "stay"])
print([x.violated_at for x in fsm.monitors])
`);
        expect(out.trim()).toBe('[None, None, None, None, None]');
    });
});

describe('notebook generator', () => {
    it('writes a valid nbformat 4.5 notebook with the module and replays', async () => {
        const { model } = await parseDiagram(EXAMPLES.find(e => e.id === 'mutex')!.source);
        const { notebook, python: py } = await generateNotebook(model, {
            verdicts: ['true', 'false', 'true', 'true'],
            counterexamples: [{ property: 'liveness', states: ['s0', 's1', 's3', 's7', 's1', 's3'], loopStart: 2 }]
        });
        const nb = JSON.parse(notebook);
        expect(nb.nbformat).toBe(4);
        expect(nb.nbformat_minor).toBe(5);
        expect(new Set(nb.cells.map((c: { id: string }) => c.id)).size).toBe(nb.cells.length);
        const sources = nb.cells.map((c: { source: string[] }) => c.source.join(''));
        expect(sources.some((s: string) => s.startsWith(`%%writefile ${py.moduleName}.py`))).toBe(true);
        expect(sources.some((s: string) => s.includes('fsm.widget('))).toBe(true);
        expect(sources.some((s: string) => s.includes('"TO_S1", "TO_S3", "TO_S7", "TO_S1"') || s.includes('"TO_S7"'))).toBe(true);
        expect(sources[0]).toContain('✗ false');
    });
});
