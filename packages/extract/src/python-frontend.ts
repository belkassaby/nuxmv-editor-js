/** Python front end: runs python_facts.py (Python's own `ast` module) and reads the facts it prints. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { emptyFacts, type Facts } from './ir.js';

const SCRIPT = fileURLToPath(new URL('./python_facts.py', import.meta.url));

export function pythonExecutable(): string {
    return process.env['PYTHON'] || 'python3';
}

export function extractPython(root: string, files: string[], overrides?: Map<string, string>): Facts {
    const facts = emptyFacts(root);
    if (files.length === 0) return facts;
    if (!existsSync(SCRIPT)) {
        facts.notes.push(`Python front end missing (${SCRIPT}); ${files.length} Python file(s) skipped.`);
        return facts;
    }
    const result = spawnSync(pythonExecutable(), [SCRIPT, root], { input: JSON.stringify({ files, overrides: Object.fromEntries(overrides ?? []) }), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (result.error || result.status !== 0) {
        const reason = result.error ? result.error.message : result.stderr.trim().split('\n').slice(-1)[0];
        facts.notes.push(`Python front end failed (${pythonExecutable()}: ${reason}); ${files.length} Python file(s) skipped. Set PYTHON to a Python 3.10+ interpreter.`);
        return facts;
    }
    const parsed = JSON.parse(result.stdout) as Omit<Facts, 'root'>;
    return { ...facts, ...parsed, root };
}
