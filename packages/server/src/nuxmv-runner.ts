import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseNuxmvOutput, type NuxmvOutput } from '@nuxmv-editor/language';

export type Engine = 'bdd' | 'bmc' | 'ic3';
export const ENGINES: Engine[] = ['bdd', 'bmc', 'ic3'];

export interface RunnerConfig {
    /** Path to the nuXmv executable (or a name found on PATH). */
    executable: string;
    timeoutMs: number;
    /** Maximum number of bytes kept from stdout/stderr. */
    maxOutputBytes: number;
}

export interface RunOptions {
    engine?: Engine;
    /** Bound for BMC (`-bmc_length`) and IC3 (`-k`). */
    bound?: number;
}

export interface RunResult extends NuxmvOutput {
    engine: Engine;
    command: string;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    truncated: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
    return {
        executable: env['NUXMV_PATH'] || 'nuXmv',
        timeoutMs: Number(env['NUXMV_TIMEOUT_MS'] ?? 60_000),
        maxOutputBytes: Number(env['NUXMV_MAX_OUTPUT_BYTES'] ?? 5_000_000)
    };
}

/** Commands used for the interactive IC3 run (CTL is still checked with BDDs). */
function ic3Script(bound: number): string {
    return [
        'set on_failure_script_quits 1',
        'go',
        'build_boolean_model',
        'check_ctlspec',
        `check_invar_ic3 -k ${bound}`,
        `check_ltlspec_ic3 -k ${bound}`,
        'quit',
        ''
    ].join('\n');
}

/** Runs nuXmv on the given model text and parses its output. */
export async function runNuxmv(model: string, options: RunOptions, config: RunnerConfig): Promise<RunResult> {
    const engine = options.engine ?? 'bdd';
    const bound = Math.max(1, Math.min(1000, Math.floor(options.bound ?? 10)));
    const dir = await mkdtemp(join(tmpdir(), 'nuxmv-editor-'));
    try {
        const modelFile = join(dir, 'model.smv');
        await writeFile(modelFile, model, 'utf8');
        const args: string[] = [];
        if (engine === 'bmc') {
            args.push('-bmc', '-bmc_length', String(bound));
        } else if (engine === 'ic3') {
            const script = join(dir, 'commands.txt');
            await writeFile(script, ic3Script(bound), 'utf8');
            args.push('-source', script);
        }
        args.push(modelFile);
        const result = await execute(config, args);
        return {
            engine,
            command: ['nuXmv', ...args.map(a => a.replace(dir, '<tmp>'))].join(' '),
            ...result,
            ...parseNuxmvOutput(result.stdout, result.stderr)
        };
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

export interface NuxmvInfo {
    available: boolean;
    executable: string;
    version?: string;
    error?: string;
}

export async function nuxmvInfo(config: RunnerConfig): Promise<NuxmvInfo> {
    try {
        const { stdout, stderr, exitCode } = await execute({ ...config, timeoutMs: 10_000 }, ['-h']);
        const version = /This is (nuXmv [^\s(]+)/.exec(stdout + stderr)?.[1];
        if (!version && exitCode !== 0) {
            return { available: false, executable: config.executable, error: (stderr || stdout).trim().split('\n')[0] };
        }
        return { available: true, executable: config.executable, version };
    } catch (error) {
        return { available: false, executable: config.executable, error: (error as Error).message };
    }
}

interface ExecResult {
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    truncated: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
}

function execute(config: RunnerConfig, args: string[]): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const child = spawn(config.executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        let size = 0;
        let truncated = false;
        let timedOut = false;
        const collect = (target: Buffer[]) => (chunk: Buffer) => {
            if (size >= config.maxOutputBytes) {
                truncated = true;
                return;
            }
            size += chunk.length;
            target.push(chunk);
        };
        child.stdout.on('data', collect(out));
        child.stderr.on('data', collect(err));
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, config.timeoutMs);
        child.on('error', error => {
            clearTimeout(timer);
            const code = (error as NodeJS.ErrnoException).code;
            reject(code === 'ENOENT' ? new Error(`nuXmv executable not found: '${config.executable}'. Set NUXMV_PATH.`) : error);
        });
        child.on('close', (exitCode, signal) => {
            clearTimeout(timer);
            resolve({
                exitCode,
                signal,
                timedOut,
                truncated,
                durationMs: Date.now() - started,
                stdout: Buffer.concat(out).toString('utf8'),
                stderr: Buffer.concat(err).toString('utf8')
            });
        });
    });
}
