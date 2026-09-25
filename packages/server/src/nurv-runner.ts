import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nurvPlan, type DiagramModel } from '@nuxmv-editor/language';

export interface NurvResult {
    /** Generated sources: <module>.py (ctypes wrapper) and <module>.c/.h per property. */
    files: Record<string, string>;
    monitors: Array<{ name: string; expression: string; module: string }>;
    log: string;
    /** How to build the shared libraries the Python wrappers load. */
    build: string[];
}

export function nurvExecutable(env: NodeJS.ProcessEnv = process.env): string | undefined {
    return env['NURV_PATH'] || undefined;
}

export function nurvAvailable(executable = nurvExecutable()): boolean {
    return !!executable && spawnSync(executable, ['-h'], { stdio: 'ignore', timeout: 10_000 }).status !== null;
}

/**
 * Runs NuRV to generate Python monitors (backed by generated C) for the LTL
 * properties of a diagram that need the future. The C files must be compiled
 * into lib<module>.so next to the Python files (see `build`).
 */
export async function runNurv(model: DiagramModel, executable: string, timeoutMs = 120_000): Promise<NurvResult> {
    const plan = await nurvPlan(model);
    if (plan.monitors.length === 0) return { files: {}, monitors: [], log: 'No LTL property needs a NuRV monitor.', build: [] };
    const dir = await mkdtemp(join(tmpdir(), 'nuxmv-editor-nurv-'));
    try {
        await writeFile(join(dir, 'model.smv'), plan.smv);
        await writeFile(join(dir, 'synthesis.cmd'), plan.script);
        await writeFile(join(dir, 'observables.list'), plan.observables.join('\n') + '\n');
        const log = await new Promise<string>((resolve, reject) => {
            const child = spawn(executable, ['-source', 'synthesis.cmd'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
            let out = '';
            child.stdout.on('data', d => (out += d));
            child.stderr.on('data', d => (out += d));
            const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
            child.on('error', reject);
            child.on('close', () => {
                clearTimeout(timer);
                resolve(out);
            });
        });
        const files: Record<string, string> = {};
        for (const name of await readdir(dir)) {
            if (!plan.monitors.some(m => name.startsWith(m.module + '.'))) continue;
            let content = await readFile(join(dir, name), 'utf8');
            // Load the compiled library from next to the wrapper, not from the current directory.
            if (name.endsWith('.py')) {
                content = content.replace('pathlib.Path().absolute()', 'pathlib.Path(__file__).resolve().parent');
                // NuRV 2.0.0's Python wrapper passes an extra argument to the generated C entry point
                // <module>_ffi(long input, int reset, int location): drop it.
                content = content.replace(/(_ffi\(input0), 1, (reset\.value, self\.current_loc\))/g, '$1, $2');
            }
            files[name] = content;
        }
        const missing = plan.monitors.filter(m => !files[`${m.module}.py`]);
        if (missing.length > 0) throw new Error(`NuRV did not generate ${missing.map(m => m.module).join(', ')}:\n${log.split('\n').filter(l => !l.startsWith('***')).slice(-15).join('\n')}`);
        return {
            files,
            monitors: plan.monitors,
            log,
            build: plan.monitors.map(m => `cc -fPIC -shared -o lib${m.module}.so ${m.module}.c`)
        };
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}
