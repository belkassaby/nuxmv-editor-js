import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkConformance, EXAMPLES, generatePython, parseDiagram, parseTrace } from '../src/index.js';

const model = async (id: string) => (await parseDiagram(EXAMPLES.find(e => e.id === id)!.source)).model;
const kinds = (r: Awaited<ReturnType<typeof checkConformance>>) => r.issues.map(i => [i.step, i.kind]);

describe('trace conformance', () => {
    it('accepts a run that follows the model, with or without events', async () => {
        const m = await model('agent-retry-data');
        const run = parseTrace(['work', 'test', 'work', 'test', 'review', 'done'].map(s => JSON.stringify({ state: s })).join('\n'));
        const report = await checkConformance(m, run);
        expect(report.conforms).toBe(true);
        expect(report.steps.at(-1)!.values).toMatchObject({ state: 'done', retries: 1, approved: true });
        expect(report.monitored).toEqual(['budget', 'approval_only_when_merged', 'merged_needs_approval']);
    });

    it('reports missing transitions, false guards, wrong events and property violations', async () => {
        const m = await model('agent-retry-data');
        const records = [
            { state: 'work' },
            { state: 'done' }, // no transition work -> done
            { state: 'test' }, // resynchronised: done -> test does not exist either
            { state: 'work', event: 'tests_failed' },
            { state: 'test', event: 'tests_passed' }, // wrong event (code_written expected)
            { state: 'work', event: 'tests_failed' },
            { state: 'test' },
            { state: 'work', event: 'tests_failed' } // retries = 2: guard false
        ];
        const report = await checkConformance(m, records);
        expect(kinds(report)).toEqual([
            [1, 'no-transition'],
            [1, 'property'],
            [2, 'no-transition'],
            [4, 'wrong-event'],
            [7, 'guard-false']
        ]);
        expect(report.issues[1].message).toMatch(/merged_needs_approval/);
        expect(report.issues[4].message).toMatch(/retries < 2 is false/);
    });

    it('checks the past-time guardrails of the coding loop on a recorded run', async () => {
        const m = await model('agent-coding-loop');
        const report = await checkConformance(m, [{ state: 'prompting' }, { state: 'deploying', event: 'hotfix' }]);
        expect(report.issues.map(i => i.kind)).toEqual(['no-transition', 'property', 'property', 'property']);
        expect(report.issues.slice(1).map(i => i.message.split(' ')[1]).sort()).toEqual(['deploys_the_merged_change', 'human_decides_release', 'staging_passed_for_this_release']);
    });

    it('rejects runs that do not start in an initial state or use unknown states', async () => {
        const m = await model('mutex');
        const report = await checkConformance(m, [{ state: 's3' }, { state: 'nowhere' }]);
        expect(kinds(report)).toEqual([
            [0, 'not-initial'],
            [1, 'unknown-state']
        ]);
    });

    it('reads OpenTelemetry spans', () => {
        const otlp = {
            resourceSpans: [
                {
                    scopeSpans: [
                        {
                            spans: [
                                { name: 'fsm.transition', startTimeUnixNano: '2', attributes: [{ key: 'fsm.state', value: { stringValue: 'test' } }, { key: 'fsm.event', value: { stringValue: 'code_written' } }, { key: 'fsm.step', value: { intValue: '1' } }] },
                                { name: 'fsm.start', startTimeUnixNano: '1', attributes: [{ key: 'fsm.state', value: { stringValue: 'work' } }, { key: 'fsm.step', value: { intValue: '0' } }, { key: 'fsm.value.retries', value: { intValue: '0' } }] }
                            ]
                        }
                    ]
                }
            ]
        };
        expect(parseTrace(JSON.stringify(otlp))).toEqual([
            { state: 'work', values: { retries: 0 }, time: '1' },
            { state: 'test', event: 'code_written', time: '2' }
        ]);
    });
});

const python = ['python3', 'python'].find(cmd => spawnSync(cmd, ['--version']).status === 0);
describe.skipIf(!python)('recorded Python runs', () => {
    it('a run recorded by the generated runtime conforms to its diagram', async () => {
        const m = await model('agent-retry-data');
        const py = await generatePython(m);
        const dir = mkdtempSync(join(tmpdir(), 'nxd-conf-'));
        writeFileSync(join(dir, `${py.moduleName}.py`), py.code);
        execFileSync(python!, ['-c', `
import random, ${py.moduleName} as m
fsm = m.${py.className}()
fsm.record_to("run.jsonl")
rng = random.Random(9)
for _ in range(80):
    ev = fsm.allowed_events()
    if not ev: break
    fsm.send(rng.choice(ev))
`], { cwd: dir });
        const records = parseTrace(readFileSync(join(dir, 'run.jsonl'), 'utf8'));
        expect(records.length).toBeGreaterThan(5);
        const report = await checkConformance(m, records);
        expect(report.issues).toEqual([]);
    });
});
