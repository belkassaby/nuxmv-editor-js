import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLES, generatePython, generateSmv, matchResults, parseDiagram } from '@provenflow/language';
import { runNurv } from '../src/nurv-runner.js';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { nuxmvInfo, runNuxmv, type RunnerConfig } from '../src/nuxmv-runner.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-nuxmv.mjs', import.meta.url));

function startServer(runner: RunnerConfig): Promise<{ url: string; server: Server }> {
    return new Promise(resolve => {
        const server = createApp({ runner }).listen(0, '127.0.0.1', () => {
            resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server });
        });
    });
}

describe('REST API (fake nuXmv)', () => {
    let url: string;
    let server: Server;
    beforeAll(async () => ({ url, server } = await startServer({ executable: FAKE, timeoutMs: 10_000, maxOutputBytes: 1_000_000 })));
    afterAll(() => server.close());

    const post = (body: unknown) =>
        fetch(`${url}/api/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    it('reports the nuXmv version', async () => {
        const body = await (await fetch(`${url}/api/health`)).json();
        expect(body.nuxmv).toMatchObject({ available: true, version: 'nuXmv 9.9.9' });
    });

    it('runs a model and returns parsed results and traces', async () => {
        const res = await post({ model: 'MODULE main', engine: 'bdd' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.results).toHaveLength(1);
        expect(body.results[0].verdict).toBe('false');
        expect(body.results[0].trace.steps.map((s: { values: { state: string } }) => s.values.state)).toEqual(['s0', 's1']);
        expect(body.results[0].trace.loopStart).toBe(1);
    });

    it('generates the model from a diagram', async () => {
        const res = await post({ diagram: EXAMPLES[0].source, engine: 'bmc', bound: 7 });
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.model).toContain('MODULE main');
        expect(body.command).toContain('-bmc -bmc_length 7');
    });

    it('rejects invalid requests', async () => {
        expect((await post({})).status).toBe(400);
        expect((await post({ model: 'x', engine: 'magic' })).status).toBe(400);
        const res = await post({ diagram: 'state s0\ns0 -> nowhere;' });
        expect(res.status).toBe(422);
        expect((await res.json()).details[0].message).toMatch(/nowhere/);
    });

    it('surfaces nuXmv errors', async () => {
        const body = await (await post({ model: 'syntax-error' })).json();
        expect(body.exitCode).toBe(1);
        expect(body.errors[0]).toMatch(/syntax error/);
    });

    it('relays live state updates to subscribers over SSE', async () => {
        const send = (channel: string, body: unknown) =>
            fetch(`${url}/api/live/${channel}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        await send('test-1', { state: 's0', step: 0 });

        const controller = new AbortController();
        const stream = await fetch(`${url}/api/live/test-1/stream`, { signal: controller.signal });
        expect(stream.headers.get('content-type')).toContain('text/event-stream');
        const reader = stream.body!.getReader();
        const received: string[] = [];
        const statuses: string[] = [];
        const read = (async () => {
            const decoder = new TextDecoder();
            let buffer = '';
            while (received.length < 2) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value);
                // Unnamed messages are state updates; 'status' events report the machines listening.
                for (const block of buffer.split('\n\n')) {
                    const data = /^data: (.*)$/m.exec(block)?.[1];
                    if (!data) continue;
                    if (/^event: status$/m.test(block)) statuses.includes(data) || statuses.push(data);
                    else if (!received.includes(data)) received.push(data);
                }
            }
        })();
        await new Promise(r => setTimeout(r, 50));
        expect((await (await send('test-1', { state: 's1', step: 1, event: 'GO' })).json()).listeners).toBe(1);
        await read;
        controller.abort();
        // The last update is replayed to a new subscriber, then new ones follow.
        expect(received.map(r => JSON.parse(r).state)).toEqual(['s0', 's1']);
        expect(JSON.parse(received[1]).event).toBe('GO');
        expect(JSON.parse(received[0]).replayed).toBe(true); // sent before we subscribed
        expect(JSON.parse(received[1]).replayed).toBeUndefined();
        expect(statuses.map(x => JSON.parse(x).machines)).toEqual([0]); // no machine listens for commands
    });

    it('validates live channels and updates', async () => {
        const post = (path: string, body: unknown) =>
            fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        expect((await post('/api/live/bad%20name', { state: 's0' })).status).toBe(400);
        expect((await post('/api/live/ok', { nostate: true })).status).toBe(400);
    });

    const python = ['python3', 'python'].find(cmd => spawnSync(cmd, ['--version']).status === 0);
    it.skipIf(!python)('two-way live link: the editor drives a running Python machine', async () => {
        const { model } = await parseDiagram(EXAMPLES.find(e => e.id === 'agent-tool-approval')!.source);
        const py = await generatePython(model);
        const dir = mkdtempSync(join(tmpdir(), 'pflow-live-'));
        writeFileSync(join(dir, `${py.moduleName}.py`), py.code);
        const proc = spawn(python!, ['-c', `
import time, ${py.moduleName} as m
fsm = m.${py.className}(on_invalid="return")
fsm.link_editor("${url}", channel="twoway", commands=True)
time.sleep(8)
`], { cwd: dir });
        try {
            const controller = new AbortController();
            const stream = await fetch(`${url}/api/live/twoway/stream`, { signal: controller.signal });
            const reader = stream.body!.getReader();
            const updates: Array<{ state: string; rejected?: unknown }> = [];
            const decoder = new TextDecoder();
            let buffer = '';
            void (async () => {
                for (;;) {
                    const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
                    if (done) return;
                    buffer += decoder.decode(value);
                    updates.splice(0, updates.length, ...[...buffer.matchAll(/^data: (.*)$/gm)].map(m => JSON.parse(m[1])).filter(u => 'state' in u));
                }
            })();
            const waitFor = async (pred: () => boolean) => {
                for (let i = 0; i < 100 && !pred(); i++) await new Promise(r => setTimeout(r, 100));
                return pred();
            };
            expect(await waitFor(() => updates.some(u => u.state === 'writing'))).toBe(true);
            const command = async (event: string) => {
                // The machine may still be connecting its command stream: retry until it listens.
                for (let i = 0; i < 40; i++) {
                    const res = await fetch(`${url}/api/live/twoway/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event }) });
                    if ((await res.json()).listeners > 0) return;
                    await new Promise(r => setTimeout(r, 100));
                }
                throw new Error('no listener');
            };
            await command('TOOL_CALL');
            expect(await waitFor(() => updates.some(u => u.state === 'approval_required'))).toBe(true);
            await command('ANSWER'); // not allowed in approval_required: rejected by the machine
            expect(await waitFor(() => updates.some(u => u.rejected))).toBe(true);
            controller.abort();
        } finally {
            proc.kill();
        }
    }, 20_000);

    it('reports a missing executable', async () => {
        const info = await nuxmvInfo({ executable: '/nonexistent/nuXmv', timeoutMs: 1000, maxOutputBytes: 1000 });
        expect(info.available).toBe(false);
    });
});

// Runs only when a real nuXmv is available, e.g. NUXMV_PATH=/opt/nuXmv/bin/nuXmv npm test
const real = process.env['NUXMV_PATH'];
describe.skipIf(!real)('real nuXmv', () => {
    const runner: RunnerConfig = { executable: real ?? '', timeoutMs: 60_000, maxOutputBytes: 5_000_000 };

    it.each(EXAMPLES.map(e => [e.id, e.source]))('verifies example %s with every engine', async (_id, source) => {
        const { model } = await parseDiagram(source);
        const text = generateSmv(model).text;
        for (const engine of ['bdd', 'bmc', 'ic3'] as const) {
            const result = await runNuxmv(text, { engine, bound: 10 }, runner);
            expect(result.errors, `${engine}: ${result.stdout}`).toEqual([]);
            expect(result.warnings.filter(w => /exhaustive/.test(w))).toEqual([]);
            const matched = matchResults(model.specs, result.results);
            if (engine === 'bdd') expect(matched.every(r => r !== undefined)).toBe(true);
        }
    });

    it.each(EXAMPLES.map(e => [e.id, e]))('gives the documented verdicts for %s', async (_id, example) => {
        const { model } = await parseDiagram(example.source);
        const result = await runNuxmv(generateSmv(model).text, { engine: 'bdd' }, runner);
        const verdicts = matchResults(model.specs, result.results).map(r => r?.verdict);
        expect(verdicts).toEqual(example.expected);
    });

    it('finds the mutual exclusion liveness counterexample', async () => {
        const { model } = await parseDiagram(EXAMPLES.find(e => e.id === 'mutex')!.source);
        const result = await runNuxmv(generateSmv(model).text, { engine: 'bdd' }, runner);
        const matched = matchResults(model.specs, result.results);
        expect(matched.map(r => r?.verdict)).toEqual(['true', 'false', 'true', 'true']);
        const trace = matched[1]!.trace!;
        expect(trace.loopStart).toBeDefined();
        expect(trace.steps[0].values['state']).toBe('s0');
    });

    it('needs fairness for the microwave property', async () => {
        const { model } = await parseDiagram(EXAMPLES.find(e => e.id === 'microwave')!.source);
        const unfair = { ...model, fairness: [] };
        const fair = matchResults(model.specs, (await runNuxmv(generateSmv(model).text, {}, runner)).results);
        const withoutFairness = matchResults(model.specs, (await runNuxmv(generateSmv(unfair).text, {}, runner)).results);
        expect(fair[0]?.verdict).toBe('true');
        expect(withoutFairness[0]?.verdict).toBe('false');
    });
});

// Runs only when NuRV is available, e.g. NURV_PATH=/opt/NuRV/NuRV npm test
const nurv = process.env['NURV_PATH'];
const py = ['python3', 'python'].find(cmd => spawnSync(cmd, ['--version']).status === 0);
const cc = spawnSync('cc', ['--version']).status === 0;
describe.skipIf(!nurv || !py || !cc)('NuRV monitors', () => {
    it('generates full-LTL monitors that decide under the model assumptions', async () => {
        const source = EXAMPLES.find(e => e.id === 'agent-chat')!.source + '\nLTLSPEC NAME closes := F turn = closed;\nLTLSPEC NAME replies := G (turn = assistant -> F turn = user);\n';
        const { model } = await parseDiagram(source);
        const result = await runNurv(model, nurv!);
        expect(result.monitors.map(m => m.name)).toEqual(['closes', 'replies']);
        const dir = mkdtempSync(join(tmpdir(), 'pflow-nurv-'));
        for (const [name, content] of Object.entries(result.files)) writeFileSync(join(dir, name), content);
        for (const cmd of result.build) {
            const [bin, ...args] = cmd.split(' ');
            expect(spawnSync(bin, args, { cwd: dir }).status).toBe(0);
        }
        const gen = await generatePython(model);
        writeFileSync(join(dir, `${gen.moduleName}.py`), gen.code);
        const out = spawnSync(py!, ['-c', `
import ${gen.moduleName} as m, nurv_closes, nurv_replies
fsm = m.${gen.className}(strict=False)
closes, replies = fsm.add_nurv_monitor(nurv_closes), fsm.add_nurv_monitor(nurv_replies)
print(closes["verdict"], replies["verdict"])
for e in ["USER_MESSAGE", "TOOL_CALL", "APPROVE", "TOOL_RESPONSE", "REPLY"]:
    fsm.send(e)
print(closes["verdict"], replies["verdict"], fsm.state.value)
`], { cwd: dir, encoding: 'utf8' });
        // 'closed' is unreachable: false right away. Replies are not guaranteed by the model
        // (the assistant may keep calling tools), so that monitor stays undecided.
        expect(out.stdout.trim().split('\n')).toEqual(['false unknown', 'false unknown idle']);
    }, 120_000);
});

describe('POST /api/extract (code base models)', () => {
    const SHOP = fileURLToPath(new URL('../../extract/test/fixtures/shop', import.meta.url));
    const runner: RunnerConfig = { executable: '/nonexistent/nuXmv', timeoutMs: 10_000, maxOutputBytes: 1_000_000 };
    const servers: Server[] = [];
    afterAll(() => servers.forEach(s => s.close()));
    const start = (allowLocalPaths: boolean) =>
        new Promise<string>(resolve => {
            const server = createApp({ runner, allowLocalPaths }).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
            servers.push(server);
        });
    const extract = (url: string, body: unknown) => fetch(`${url}/api/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    it('analyses a folder of the server by path, with the models as .pflow text', async () => {
        const url = await start(true);
        expect((await (await fetch(`${url}/api/health`)).json()).extract).toEqual({ paths: true });
        const res = await extract(url, { path: SHOP });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.checkedWith).toBe('explicit');
        expect(body.findings.some((f: { rule: string }) => f.rule === 'resource-leak')).toBe(true);
        const order = body.models.find((m: { subject: string }) => m.subject === 'Order.status');
        expect(order.pflow).toContain('diagram Order_status');
        expect(body.markdown).toContain('# ProvenFlow code model report');
    });

    it('analyses uploaded files, with the config sent along', async () => {
        const url = await start(false);
        const files = {
            'src/poller.ts': 'export class Poller {\n    private timer?: ReturnType<typeof setInterval>;\n    start(): void {\n        this.timer = setInterval(() => undefined, 1000);\n    }\n    stop(): void {\n        clearInterval(this.timer);\n    }\n}\n'
        };
        const body = await (await extract(url, { files, config: { ignore: [] } })).json();
        expect(body.root).toBe('(uploaded folder)');
        expect(body.findings.map((f: { rule: string }) => f.rule)).toContain('resource-leak');
    });

    it('refuses paths when not allowed, and unsafe uploads', async () => {
        const url = await start(false);
        expect((await extract(url, { path: SHOP })).status).toBe(403);
        expect((await extract(url, { files: { '../escape.ts': 'x' } })).status).toBe(400);
        expect((await extract(url, {})).status).toBe(400);
    });
});
