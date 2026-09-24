#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { generateSmv, matchResults, parseDiagram } from '@nuxmv-editor/language';
import { configFromEnv, ENGINES, runNuxmv, type Engine } from './nuxmv-runner.js';

const USAGE = `Usage:
  nxd generate <diagram.nxd> [-o model.smv]      write the nuXmv model
  nxd check <diagram.nxd> [--engine bdd|bmc|ic3] [--bound N]
                                                 verify the specifications with nuXmv (NUXMV_PATH)`;

async function main(): Promise<number> {
    const { positionals, values } = parseArgs({
        allowPositionals: true,
        options: {
            output: { type: 'string', short: 'o' },
            engine: { type: 'string', default: 'bdd' },
            bound: { type: 'string', default: '10' },
            help: { type: 'boolean', short: 'h' }
        }
    });
    const [command, file] = positionals;
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
