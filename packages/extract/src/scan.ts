/** Lists the source files of a project, honouring .gitignore when the project is a git repository. */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const DEFAULT_EXCLUDE = ['**/node_modules/**', '**/dist/**', '**/out/**', '**/build/**', '**/.angular/**', '**/*.d.ts', '**/generated/**', '**/.venv/**', '**/venv/**', '**/__pycache__/**'];
const EXTENSIONS = /\.(ts|tsx|mts|cts|py)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.angular', '.venv', 'venv', '__pycache__', '.provenflow']);

export function listSourceFiles(root: string, include: string[] = [], exclude: string[] = []): string[] {
    const all = gitFiles(root) ?? walk(root);
    const excluded = [...DEFAULT_EXCLUDE, ...exclude].map(globToRegExp);
    const included = include.map(globToRegExp);
    return all
        .filter(f => EXTENSIONS.test(f))
        .filter(f => !excluded.some(re => re.test(f)))
        .filter(f => included.length === 0 || included.some(re => re.test(f)))
        .sort();
}

function gitFiles(root: string): string[] | undefined {
    const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0 || !result.stdout) return undefined;
    const prefix = spawnSync('git', ['rev-parse', '--show-prefix'], { cwd: root, encoding: 'utf8' }).stdout?.trim() ?? '';
    return result.stdout
        .split('\n')
        .filter(Boolean)
        .map(f => (prefix && f.startsWith(prefix) ? f.slice(prefix.length) : f))
        .filter(f => {
            try {
                return statSync(join(root, f)).isFile();
            } catch {
                return false; // deleted but still in the index
            }
        });
}

function walk(root: string, dir = root, files: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') && entry.name !== '.github') continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(root, path, files);
        } else if (entry.isFile()) {
            files.push(relative(root, path).split('\\').join('/'));
        }
    }
    return files;
}

export function isTestFile(file: string): boolean {
    return /(^|\/)(test|tests|__tests__|spec)\//.test(file) || /\.(test|spec)\.[cm]?[tj]sx?$/.test(file) || /(^|\/)test_[^/]*\.py$/.test(file) || /_test\.py$/.test(file) || /(^|\/)conftest\.py$/.test(file);
}

/** `**` matches any number of directories, `*` anything but `/`, `?` one character. */
export function globToRegExp(glob: string): RegExp {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
            i += glob[i + 2] === '/' ? 2 : 1;
        } else if (c === '*') re += '[^/]*';
        else if (c === '?') re += '[^/]';
        else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    // A directory pattern also matches everything below it.
    return new RegExp(`^${re}(?:/.*)?$`);
}

export function matchesAny(file: string, globs: string[]): boolean {
    return globs.some(g => globToRegExp(g).test(file));
}
