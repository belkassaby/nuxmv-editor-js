import { Injectable, signal } from '@angular/core';

/** A place in the analysed code base. */
export interface CodeLocation {
    file: string;
    line: number;
}

export interface CodeFinding {
    rule: string;
    category: 'state-machine' | 'lifecycle' | 'pattern' | 'paradigm' | 'architecture';
    severity: 'error' | 'warning' | 'info';
    subject: string;
    message: string;
    fix: string;
    loc?: CodeLocation;
    model?: string;
    spec?: string;
    counterexample?: Array<{ state: string; event?: string; loc?: CodeLocation }>;
    source: 'analysis' | 'nuxmv' | 'graph' | 'llm';
}

export interface CodeModel {
    id: string;
    kind: 'state-machine' | 'lifecycle' | 'pattern' | 'architecture';
    subject: string;
    loc?: CodeLocation;
    states: number;
    transitions: number;
    properties: number;
    failed: string[];
    notes: string[];
    pflow: string;
}

export interface CodeReport {
    root: string;
    files: number;
    checkedWith: 'nuxmv' | 'explicit';
    summary: { error: number; warning: number; info: number };
    findings: CodeFinding[];
    models: CodeModel[];
    verdicts: Array<{ model: string; spec: string; verdict: string }>;
    patterns: Array<{ pattern: string; subject: string; loc: CodeLocation; evidence: string; model?: string }>;
    paradigm: Array<{ part: string; declared?: string; detected: string; files: number; classes: number; methods: number; freeFunctions: number; pureFunctions: number; mutationDensity: number; mutableGlobals: number }>;
    architecture: { edges: Array<{ from: string; to: string; count: number; typeOnly: boolean }> };
    notes: string[];
    markdown: string;
}

/** What the analysis reads: sources, Angular templates, and the files that describe the project. */
const WANTED = /(\.(ts|tsx|mts|cts|py|html)|(^|\/)(package\.json|provenflow\.config\.json))$/;
const SKIPPED_DIR = /(^|\/)(node_modules|\.git|dist|out|build|\.angular|\.venv|venv|__pycache__|\.provenflow|coverage)\//;
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1_000_000;

/** Sends a code base to the server (`pflow extract`) and keeps its report. */
@Injectable({ providedIn: 'root' })
export class CodeImport {
    readonly running = signal(false);
    readonly progress = signal('');
    readonly error = signal<string | null>(null);
    readonly report = signal<CodeReport | null>(null);
    /** The server can read a folder by path (it runs on this machine). */
    readonly pathsAllowed = signal(false);

    async refresh(): Promise<void> {
        try {
            const health = (await (await fetch('api/health')).json()) as { extract?: { paths?: boolean } };
            this.pathsAllowed.set(!!health.extract?.paths);
        } catch {
            this.pathsAllowed.set(false);
        }
    }

    analysePath(path: string): Promise<void> {
        return this.run(`Analysing ${path}…`, { path: path.trim() });
    }

    /** Uploads the relevant files of a folder picked in the browser (webkitdirectory). */
    async analyseFolder(list: FileList | null): Promise<void> {
        const files = Array.from(list ?? []);
        if (files.length === 0) return;
        const picked: Record<string, string> = {};
        let skipped = 0;
        for (const file of files) {
            // "project/src/a.ts" -> "src/a.ts": paths are relative to the chosen folder.
            const path = file.webkitRelativePath.split('/').slice(1).join('/') || file.name;
            if (SKIPPED_DIR.test(`/${path}`) || !WANTED.test(path) || path.endsWith('.d.ts')) continue;
            if (file.size > MAX_FILE_BYTES || Object.keys(picked).length >= MAX_FILES) {
                skipped++;
                continue;
            }
            picked[path] = await file.text();
        }
        const count = Object.keys(picked).length;
        if (count === 0) {
            this.error.set('No TypeScript, JavaScript module or Python files in that folder.');
            return;
        }
        const folder = files[0].webkitRelativePath.split('/')[0] || 'folder';
        return this.run(`Uploading and analysing ${count} files of ${folder}${skipped ? ` (${skipped} skipped: too large or too many)` : ''}…`, { files: picked }, folder);
    }

    private async run(progress: string, body: unknown, name?: string): Promise<void> {
        this.running.set(true);
        this.error.set(null);
        this.progress.set(progress);
        try {
            const res = await fetch('api/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            const json = (await res.json()) as CodeReport & { error?: string };
            if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
            this.report.set(name ? { ...json, root: name } : json);
        } catch (error) {
            this.error.set(`The analysis failed: ${(error as Error).message}`);
        } finally {
            this.running.set(false);
            this.progress.set('');
        }
    }

    clear(): void {
        this.report.set(null);
        this.error.set(null);
    }
}
