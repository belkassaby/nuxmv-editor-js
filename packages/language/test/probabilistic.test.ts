import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyse, buildDtmc, EXAMPLES, exportPrism, parseDiagram, type ProbabilisticQuery } from '../src/index.js';

const model = async (id: string) => (await parseDiagram(EXAMPLES.find(e => e.id === id)!.source)).model;
const queries: ProbabilisticQuery[] = [
    { kind: 'reach', target: 'phase = done' },
    { kind: 'reach', target: 'phase = done', bound: 6 },
    { kind: 'steps', target: 'phase = done' },
    { kind: 'visits', count: 'phase = escalated', target: 'phase = done' }
];

describe('probabilistic analysis', () => {
    it('matches the values computed by PRISM 4.10.1 on the retry budget model', async () => {
        const { results, dtmc } = await analyse(await model('agent-retry-data'), queries);
        expect(dtmc.configurations).toHaveLength(13);
        // Reference values from PRISM 4.10.1 on the exported model.
        expect(results[0].value).toBeCloseTo(1, 9);
        expect(results[1].value).toBeCloseTo(0.6835937499999999, 9);
        expect(results[2].value).toBeCloseTo(6, 4);
        expect(results[3].value).toBeCloseTo(0.0598005, 5);
    });

    it('differs from nondeterministic verification where it should', async () => {
        const { results } = await analyse(await model('agent-chat'), [
            { kind: 'reach', target: 'turn = closed' },
            { kind: 'reach', target: 'turn = tool' },
            { kind: 'steps', target: 'turn = tool' },
            { kind: 'steps', target: 'turn = closed' }
        ]);
        expect(results[0].value).toBe(0); // 'done' is unreachable in the chat agent
        // nuXmv: a run may chat forever without using the tool. In the Markov chain every lap has
        // a positive chance of using it, so it is used with probability 1, after 9 steps on average.
        expect(results[1].value).toBeCloseTo(1, 9);
        expect(results[2].value).toBeCloseTo(9, 6);
        expect(results[3].value).toBe(Infinity); // never reached: no finite expectation
    });

    it('builds distributions that sum to 1, with stutter for final states', async () => {
        const { dtmc } = await buildDtmc(await model('agent-coding-loop'));
        for (const succ of dtmc.successors) expect(succ.reduce((s, [, p]) => s + p, 0)).toBeCloseTo(1, 12);
        const live = dtmc.configurations.findIndex(c => c.state === 'live');
        expect(dtmc.successors[live]).toEqual([[live, 1, expect.anything()]]);
    });

    it('exports a PRISM model with labels, rewards and properties', async () => {
        const out = await exportPrism(await model('agent-retry-data'), queries);
        expect(out.model).toMatch(/^\/\/.*\ndtmc\n/);
        expect(out.model).toContain('label "done" =');
        expect(out.model).toContain('rewards "steps"');
        expect(out.properties).toContain('P=? [ F<=6');
    });
});

// Set PRISM_PATH to the prism launcher to cross-check against PRISM itself.
const prism = process.env['PRISM_PATH'];
describe.skipIf(!prism || !existsSync(prism))('PRISM', () => {
    it('computes the same values from the exported model', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'nxd-prism-'));
        const out = await exportPrism(await model('agent-retry-data'), queries);
        writeFileSync(join(dir, 'model.pm'), out.model);
        writeFileSync(join(dir, 'props.pctl'), out.properties);
        const text = execFileSync(prism!, [join(dir, 'model.pm'), join(dir, 'props.pctl')], { encoding: 'utf8' });
        const values = [...text.matchAll(/^Result: ([0-9.eE-]+)/gm)].map(m => Number(m[1]));
        const { results } = await analyse(await model('agent-retry-data'), queries);
        expect(values).toHaveLength(4);
        values.forEach((v, i) => expect(results[i].value).toBeCloseTo(v, 4));
    }, 120_000);
});
