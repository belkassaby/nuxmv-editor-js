import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { EXAMPLES, exportToFramework, generatePython, parseDiagram } from '../src/index.js';

const model = async (id: string) => (await parseDiagram(EXAMPLES.find(e => e.id === id)!.source)).model;

describe('XState export', () => {
    it('runs the verified machine with guards, updates and final states', async () => {
        const m = await model('agent-retry-data');
        const out = await exportToFramework(m, 'xstate');
        const dir = join(__dirname, '.generated');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, out.fileName), out.code);
        const { machine } = await import(join(dir, out.fileName));
        const actor = createActor(machine).start();
        const send = (type: string) => actor.send({ type } as never);
        send('CODE_WRITTEN');
        send('TESTS_FAILED');
        send('CODE_WRITTEN');
        send('TESTS_FAILED');
        send('CODE_WRITTEN');
        expect(actor.getSnapshot().context).toEqual({ retries: 2, approved: false });
        send('TESTS_FAILED'); // guard retries < 2 is false: ignored by XState
        expect(actor.getSnapshot().value).toBe('test');
        send('ESCALATE');
        send('RESET');
        expect(actor.getSnapshot().context.retries).toBe(0);
        send('CODE_WRITTEN');
        send('TESTS_PASSED');
        send('APPROVE');
        expect(actor.getSnapshot().value).toBe('done');
        expect(actor.getSnapshot().status).toBe('done');
        expect(actor.getSnapshot().context.approved).toBe(true);
    });

    it('exports every example', async () => {
        for (const e of EXAMPLES) {
            const out = await exportToFramework((await parseDiagram(e.source)).model, 'xstate');
            expect(out.code).toContain('createMachine');
        }
    });
});

const python = ['python3', 'python'].find(cmd => spawnSync(cmd, ['--version']).status === 0);
const has = (mod: string) => !!python && spawnSync(python, ['-c', `import ${mod}`]).status === 0;

describe.skipIf(!python)('Python framework exports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pflow-fw-'));
    const setup = async (id: string) => {
        const m = await model(id);
        const py = await generatePython(m);
        writeFileSync(join(dir, `${py.moduleName}.py`), py.code);
        const files: Record<string, string> = {};
        for (const f of ['langgraph', 'burr', 'temporal'] as const) {
            const x = await exportToFramework(m, f);
            writeFileSync(join(dir, x.fileName), x.code);
            files[f] = x.fileName.replace(/\.py$/, '');
        }
        return { py, files };
    };
    const progress = (module: string) => `
import ${module} as fsm_module
_dist = {s: 0 for s in fsm_module.TERMINAL_STATES}
for _ in range(len(fsm_module.State)):
    for (src, ev), dst in fsm_module.TRANSITIONS.items():
        if dst in _dist and _dist.get(src, 10**9) > _dist[dst] + 1: _dist[src] = _dist[dst] + 1
def decide(state, allowed, values):
    return min(allowed, key=lambda e: _dist.get(fsm_module.TRANSITIONS[(fsm_module.State(state), fsm_module.Event(e))], 10**9))
`;

    it('every export compiles', async () => {
        const { files } = await setup('agent-coding-loop');
        execFileSync(python!, ['-m', 'py_compile', ...Object.values(files).map(f => join(dir, `${f}.py`))]);
    });

    it.skipIf(!has('langgraph'))('LangGraph runs to the final state and rejects illegal choices', async () => {
        const { py, files } = await setup('agent-coding-loop');
        const out = execFileSync(python!, ['-c', `${progress(py.moduleName)}
import ${files.langgraph} as g
app = g.build_graph(decide)
result = app.invoke(g.initial_state(), config={"recursion_limit": 200})
print(result["fsm_state"], len(result["history"]))
try:
    g.build_graph(lambda s, a, v: "HUMAN_APPROVED").invoke(g.initial_state())
except fsm_module.InvalidTransition:
    print("rejected")
`], { cwd: dir, encoding: 'utf8' });
        expect(out).toContain('live 13');
        expect(out).toContain('rejected');
    });

    it.skipIf(!has('burr'))('Burr runs to the final state', async () => {
        const { py, files } = await setup('agent-retry-data');
        const out = execFileSync(python!, ['-c', `${progress(py.moduleName)}
import ${files.burr} as b
action, result, state = b.build_application(decide).run(halt_after=b.FINAL_STATES)
print(state["fsm_state"], state["history"])
`], { cwd: dir, encoding: 'utf8' });
        expect(out).toContain("done ['CODE_WRITTEN', 'TESTS_PASSED', 'APPROVE']");
    });

    it.skipIf(!has('temporalio'))('Temporal workflow waits for the human and only takes verified moves', async () => {
        const { files } = await setup('agent-retry-data');
        const out = execFileSync(python!, ['-c', `
import asyncio, uuid
from temporalio import activity
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker
import ${files.temporal} as t

@activity.defn(name="decide")
async def decide(state, allowed, values):
    return "TESTS_PASSED" if "TESTS_PASSED" in allowed else allowed[0]

async def main():
    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(env.client, task_queue="q", workflows=[t.RetryBudgetWorkflow], activities=[decide]):
            h = await env.client.start_workflow(t.RetryBudgetWorkflow.run, id=str(uuid.uuid4()), task_queue="q")
            await h.signal(t.RetryBudgetWorkflow.human_event, "MERGE_WITHOUT_REVIEW")
            await h.signal(t.RetryBudgetWorkflow.human_event, "APPROVE")
            print(await h.result())
asyncio.run(main())
`], { cwd: dir, encoding: 'utf8', timeout: 240_000 });
        // Temporal logs on stdout too: the result is the last line.
        expect(out.trim().split('\n').at(-1)).toBe("['CODE_WRITTEN', 'TESTS_PASSED', 'APPROVE']");
    }, 300_000);
});
