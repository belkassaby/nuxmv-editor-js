#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { analyse, checkConformance, exportPrism, exportToFramework, importGraph, serializeDiagram, type ProbabilisticQuery, FRAMEWORKS, generateNotebook, generatePython, generatePythonTests, generateSmv, matchResults, parseDiagram, parseTrace, type Framework } from '@nuxmv-editor/language';
import { configFromEnv, ENGINES, runNuxmv, type Engine } from './nuxmv-runner.js';
import { nurvExecutable, runNurv } from './nurv-runner.js';
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

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
  nxd import <graph> [-o diagram.nxd]            import a LangGraph (JSON, Mermaid, source), CrewAI Flow,
                                                 Mermaid or XState graph as a diagram
  nxd prob <diagram.nxd> [--reach EXPR] [--within K] [--steps EXPR] [--visits EXPR --until EXPR]
                                                 probabilistic analysis of the diagram as a Markov chain
  nxd prism <diagram.nxd> [-o model.pm] [--reach EXPR ...]
                                                 export the Markov chain to PRISM / Storm (model + .pctl)
  nxd nurv <diagram.nxd> [-o dir]               generate full-LTL Python monitors with NuRV (NURV_PATH)
                                                 and compile them with cc when available
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
            verify: { type: 'boolean', default: false },
            reach: { type: 'string', multiple: true },
            within: { type: 'string' },
            steps: { type: 'string', multiple: true },
            visits: { type: 'string' },
            until: { type: 'string' }
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

    if (command === 'import') {
        const result = importGraph(await readFile(file, 'utf8'));
        result.notes.forEach(n => console.error(`note: ${n}`));
        const nxd = serializeDiagram(result.model);
        if (values.output) await writeFile(values.output, nxd, 'utf8');
        else process.stdout.write(nxd);
        return 0;
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
    if (command === 'prob' || command === 'prism') {
        const queries: ProbabilisticQuery[] = [
            ...(values.reach ?? []).map(target => ({ kind: 'reach' as const, target, ...(values.within ? { bound: Number(values.within) } : {}) })),
            ...(values.steps ?? []).map(target => ({ kind: 'steps' as const, target })),
            ...(values.visits && values.until ? [{ kind: 'visits' as const, count: values.visits, target: values.until }] : [])
        ];
        if (command === 'prism') {
            const out = await exportPrism(parsed.model, queries);
            const target = values.output ?? `${(parsed.model.name ?? 'main').toLowerCase()}.pm`;
            await writeFile(target, out.model, 'utf8');
            await writeFile(target.replace(/\.pm$/, '') + '.pctl', out.properties, 'utf8');
            console.log(`wrote ${target} and ${target.replace(/\.pm$/, '')}.pctl`);
            return 0;
        }
        if (queries.length === 0) throw new Error('Give at least one query, e.g. --reach "phase = done".');
        const { dtmc, results } = await analyse(parsed.model, queries);
        console.log(`${dtmc.configurations.length} configuration(s)${dtmc.normalised ? ' (some probabilities filled in or normalised)' : ''}`);
        for (const r of results) console.log(r.description);
        return 0;
    }
    if (command === 'nurv') {
        const executable = nurvExecutable();
        if (!executable) throw new Error('Set NURV_PATH to the NuRV executable (https://es-static.fbk.eu/tools/nurv/).');
        const result = await runNurv(parsed.model, executable);
        const dir = values.output ?? '.';
        await mkdir(dir, { recursive: true });
        for (const [name, content] of Object.entries(result.files)) await writeFile(join(dir, name), content, 'utf8');
        for (const cmd of result.build) {
            const [cc, ...args] = cmd.split(' ');
            const r = spawnSync(cc, args, { cwd: dir, stdio: 'inherit' });
            console.log(r.status === 0 ? `built: ${cmd}` : `could not run '${cmd}' (build it yourself in ${dir})`);
        }
        for (const m of result.monitors) console.log(`monitor ${m.module}: LTLSPEC ${m.name} := ${m.expression}   ->   fsm.add_nurv_monitor(${m.module})`);
        if (result.monitors.length === 0) console.log(result.log);
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
