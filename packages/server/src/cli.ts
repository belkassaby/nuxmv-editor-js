#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { checkConformance, exportToFramework, FRAMEWORKS, generateNotebook, generatePython, generatePythonTests, generateSmv, matchResults, parseDiagram, parseTrace, type Framework } from '@nuxmv-editor/language';
import { configFromEnv, ENGINES, runNuxmv, type Engine } from './nuxmv-runner.js';

const USAGE = `Usage:
  nxd generate <diagram.nxd> [-o model.smv]      write the nuXmv model
  nxd check <diagram.nxd> [--engine bdd|bmc|ic3] [--bound N]
                                                 verify the specifications with nuXmv (NUXMV_PATH)
  nxd python <diagram.nxd> [-o module.py]        write the Python implementation of the state machine
  nxd notebook <diagram.nxd> [-o notebook.ipynb] [--verify]
                                                 write a Jupyter notebook showcasing it; --verify runs
                                                 nuXmv first to include verdicts and counterexamples
  nxd pytest <diagram.nxd> [-o test_module.py] [--verify]
                                                 write Hypothesis property-based tests for the Python module
  nxd export <xstate|langgraph|burr|temporal> <diagram.nxd> [-o file]
                                                 export the verified machine to an agent/workflow framework
  nxd conform <diagram.nxd> <run.jsonl|otel.json>
                                                 check a recorded run against the model (exit 4 if it deviates)`;

async function main(): Promise<number> {
    const { positionals, values } = parseArgs({
        allowPositionals: true,
        options: {
            output: { type: 'string', short: 'o' },
            engine: { type: 'string', default: 'bdd' },
            bound: { type: 'string', default: '10' },
            help: { type: 'boolean', short: 'h' },
            verify: { type: 'boolean', default: false }
        }
    });
    const [command, ...rest] = positionals;
    // nxd export <framework> <diagram>: the diagram is the second argument.
    const framework = command === 'export' ? rest.shift() : undefined;
    const [file, second] = rest;
    if (values.help || !command || !file) {
        console.log(USAGE);
        return values.help ? 0 : 2;
    }

    const parsed = await parseDiagram(await readFile(file, 'utf8'));
    for (const d of parsed.diagnostics) {
        if (d.severity === 'error' || d.severity === 'warning') console.error(`${file}:${d.line}:${d.column}: ${d.severity}: ${d.message}`);
    }
    if (parsed.hasErrors) return 1;
    const { text } = generateSmv(parsed.model);

    if (command === 'generate') {
        if (values.output) await writeFile(values.output, text, 'utf8');
        else process.stdout.write(text);
        return 0;
    }
    if (command === 'python') {
        const py = await generatePython(parsed.model, { sourceName: file });
        if (values.output) await writeFile(values.output, py.code, 'utf8');
        else process.stdout.write(py.code);
        return 0;
    }
    if (command === 'notebook') {
        let verdicts: Array<string | undefined> | undefined;
        let counterexamples: Array<{ property: string; states: string[]; loopStart?: number }> | undefined;
        if (values.verify) {
            const result = await runNuxmv(text, { engine: 'bdd' }, configFromEnv());
            result.errors.forEach(e => console.error(e));
            const matched = matchResults(parsed.model.specs, result.results);
            verdicts = matched.map(r => r?.verdict);
            counterexamples = matched.flatMap((r, i) =>
                r?.trace
                    ? [{ property: parsed.model.specs[i].name ?? parsed.model.specs[i].expression, states: r.trace.steps.map(s => s.values['state'] ?? ''), loopStart: r.trace.loopStart }]
                    : []
            );
        }
        const { notebook, python } = await generateNotebook(parsed.model, { sourceName: file, verdicts, counterexamples });
        const out = values.output ?? `${python.moduleName}.ipynb`;
        await writeFile(out, notebook, 'utf8');
        console.log(`wrote ${out}`);
        return 0;
    }
    if (command === 'pytest') {
        let counterexamples: Array<{ property: string; states: string[] }> | undefined;
        if (values.verify) {
            const result = await runNuxmv(text, { engine: 'bdd' }, configFromEnv());
            const matched = matchResults(parsed.model.specs, result.results);
            counterexamples = matched.flatMap((r, i) => (r?.trace ? [{ property: parsed.model.specs[i].name ?? parsed.model.specs[i].expression, states: r.trace.steps.map(s => s.values['state'] ?? '') }] : []));
        }
        const tests = await generatePythonTests(parsed.model, { sourceName: file, counterexamples });
        const out = values.output ?? tests.fileName;
        await writeFile(out, tests.code, 'utf8');
        console.log(`wrote ${out}`);
        return 0;
    }
    if (command === 'export') {
        if (!FRAMEWORKS.some(f => f.id === framework)) throw new Error(`Unknown framework '${framework}'. Use one of ${FRAMEWORKS.map(f => f.id).join(', ')}.`);
        const out = await exportToFramework(parsed.model, framework as Framework);
        const target = values.output ?? out.fileName;
        await writeFile(target, out.code, 'utf8');
        console.log(`wrote ${target}${out.requires.length ? ` (needs ${out.requires.join(', ')}: nxd python ${file})` : ''}`);
        return 0;
    }
    if (command === 'conform') {
        if (!second) throw new Error('Usage: nxd conform <diagram.nxd> <run.jsonl|otel.json>');
        const records = parseTrace(await readFile(second, 'utf8'));
        const report = await checkConformance(parsed.model, records);
        for (const issue of report.issues) console.log(`step ${issue.step}: ${issue.kind}: ${issue.message}`);
        console.log(`${records.length} step(s), ${report.issues.length} issue(s); monitored: ${report.monitored.join(', ') || 'none'}`);
        return report.conforms ? 0 : 4;
    }
    if (command === 'check') {
        const engine = values.engine as Engine;
        if (!ENGINES.includes(engine)) throw new Error(`Unknown engine '${engine}'.`);
        const result = await runNuxmv(text, { engine, bound: Number(values.bound) }, configFromEnv());
        result.errors.forEach(e => console.error(e));
        const matched = matchResults(parsed.model.specs, result.results);
        let failed = false;
        parsed.model.specs.forEach((spec, i) => {
            const r = matched[i];
            const verdict = r?.verdict ?? 'not checked';
            if (verdict === 'false') failed = true;
            console.log(`${verdict.padEnd(11)} ${spec.kind} ${spec.name ? spec.name + ' := ' : ''}${spec.expression}${r?.detail ? `  (${r.detail})` : ''}`);
            if (r?.trace) {
                r.trace.steps.forEach((step, n) => {
                    const loop = r.trace?.loopStart === n ? '  <- loop starts' : '';
                    console.log(`              ${step.id}: state = ${step.values['state'] ?? '?'}${loop}`);
                });
            }
        });
        return result.errors.length > 0 ? 1 : failed ? 3 : 0;
    }
    console.error(USAGE);
    return 2;
}

main().then(
    code => process.exit(code),
    error => {
        console.error((error as Error).message);
        process.exit(1);
    }
);
