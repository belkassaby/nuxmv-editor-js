import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLES, generateSmv, matchResults, parseDiagram } from '@nuxmv-editor/language';
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
