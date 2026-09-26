/**
 * Code changes for findings, and their verification.
 *
 * A proposal is a set of exact search/replace edits, from a deterministic
 * quick fix (below) or from an LLM (llm.ts). It is applied in memory, the
 * whole analysis is re-run on the patched files, and the change is marked
 * verified only if the finding is gone and no new warning or error appears.
 * The patched files travel with the finding (before/after), so the editor
 * can show them side by side and apply them.
 *
 * Quick fixes are mechanical and keep the behaviour the code had, or make
 * the one change the finding asks for:
 *   - unhandled-state / non-exhaustive-dispatch: list the missing values as
 *     explicit cases that do what the code did for them before (nothing);
 *   - stale-write-after-await: re-check the state just before the write;
 *   - resource-leak: release the previous resource before acquiring a new
 *     one, and add a dispose method that releases it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Facts, ResourceKind } from './ir.js';
import type { ExtractedModel, Finding, PatchFile } from './models.js';

export interface Edit {
    file: string;
    search: string;
    replace: string;
}

export interface Proposal {
    finding: Finding;
    edits: Edit[];
    explanation: string;
    /** `quick fix`, or the LLM provider. */
    by: string;
}

/** Re-runs the analysis with some files replaced and returns the findings. */
export type Rerun = (overrides: Map<string, string>) => Promise<Finding[]>;

const key = (f: Finding) => `${f.rule}|${f.subject}|${f.loc?.file ?? ''}`;

/** Applies each proposal in memory, re-runs every check, and attaches the verified (or not) patch to its finding. */
export async function verifyProposals(findings: Finding[], proposals: Proposal[], root: string, rerun: Rerun, read: (file: string) => string | undefined = f => readSafe(join(root, f))): Promise<{ findings: Finding[]; accepted: string[]; rejected: string[] }> {
    const accepted: string[] = [];
    const rejected: string[] = [];
    const before = new Set(findings.map(key));
    const patched = new Map<Finding, Finding>();
    for (const p of proposals) {
        const overrides = new Map<string, string>();
        let problem = '';
        for (const e of p.edits) {
            const current = overrides.get(e.file) ?? read(e.file);
            if (current === undefined || e.search === '' || current.split(e.search).length !== 2) {
                problem = `the edit for ${e.file} does not match the file exactly once`;
                break;
            }
            overrides.set(e.file, current.replace(e.search, () => e.replace));
        }
        const files: PatchFile[] = [...overrides].map(([file, after]) => ({ file, before: read(file) ?? '', after }));
        const diff = files.map(f => lineDiff(f.file, f.before, f.after)).join('\n');
        if (problem) {
            patched.set(p.finding, { ...p.finding, suggestedPatch: { diff, files, verified: false, note: problem, by: p.by } });
            rejected.push(`${p.by}: ${p.finding.rule} ${p.finding.subject}: ${problem}`);
            continue;
        }
        const after = await rerun(overrides);
        const stillThere = after.some(x => key(x) === key(p.finding));
        const added = after.filter(x => !before.has(key(x)) && x.severity !== 'info');
        const verified = !stillThere && added.length === 0;
        const note = verified
            ? `${p.explanation} Re-running every check on the changed code: the finding is gone and nothing new appears.`
            : stillThere
              ? `${p.explanation} The finding is still reported on the changed code.`
              : `${p.explanation} The change introduces: ${[...new Set(added.map(x => x.rule))].join(', ')}.`;
        patched.set(p.finding, { ...p.finding, suggestedPatch: { diff, files, verified, note, by: p.by } });
        (verified ? accepted : rejected).push(`${p.by}: ${p.finding.rule} ${p.finding.subject}: ${verified ? 'verified' : 'not verified'}`);
    }
    return { findings: findings.map(f => patched.get(f) ?? f), accepted, rejected };
}

// ------------------------------------------------------------------ quick fixes

export function quickFixes(findings: Finding[], facts: Facts, models: ExtractedModel[], read: (file: string) => string | undefined): Proposal[] {
    const proposals: Proposal[] = [];
    for (const f of findings) {
        if (f.suggestedPatch || !f.loc) continue;
        const text = read(f.loc.file);
        if (text === undefined) continue;
        let p: Proposal | undefined;
        if (f.rule === 'unhandled-state' || f.rule === 'non-exhaustive-dispatch') p = missingCases(f, facts, text);
        else if (f.rule === 'stale-write-after-await') p = recheckAfterAwait(f, facts, text);
        else if (f.rule === 'resource-leak') p = releaseResource(f, facts, models, text);
        if (p) proposals.push(p);
    }
    return proposals;
}

/** The missing values as explicit cases doing what the code did for them before: nothing. */
function missingCases(f: Finding, facts: Facts, text: string): Proposal | undefined {
    const sw = facts.switches.find(s => s.loc.file === f.loc!.file && s.loc.line === f.loc!.line);
    if (!sw) return undefined;
    const missing = sw.domain.filter(v => !sw.cases.includes(v));
    if (missing.length === 0) return undefined;
    const lines = text.split('\n');
    const start = offsetOfLine(text, sw.loc.line);
    const file = f.loc!.file;
    const ext = file.replace(/^.*\./, '');

    if (ext === 'py') {
        // match subject:  ... case X: ...  -> append `case A | B: pass`
        const matchLine = lines[sw.loc.line - 1];
        const indent = /^(\s*)/.exec(matchLine)![1];
        const caseLines: number[] = [];
        for (let i = sw.loc.line; i < lines.length; i++) {
            const l = lines[i];
            if (l.trim() === '') continue;
            const ind = /^(\s*)/.exec(l)![1];
            if (ind.length <= indent.length) break;
            if (/^\s*case\b/.test(l)) caseLines.push(i);
        }
        if (caseLines.length === 0) return undefined;
        const template = /^\s*case\s+(.+?)\s*:/.exec(lines[caseLines[0]])?.[1];
        const caseIndent = /^(\s*)/.exec(lines[caseLines[0]])![1];
        if (!template) return undefined;
        let end = caseLines[caseLines.length - 1] + 1;
        while (end < lines.length && (lines[end].trim() === '' || /^(\s*)/.exec(lines[end])![1].length > caseIndent.length)) end++;
        while (end > 0 && lines[end - 1].trim() === '') end--;
        const labels = missing.map(v => spell(template, sw.cases[0], v)).join(' | ');
        const anchor = lines.slice(caseLines[0], end).join('\n');
        const addition = `\n${caseIndent}case ${labels}:\n${caseIndent}    pass  # pflow: these states were not handled before either: decide what they should do`;
        return { finding: f, edits: [{ file, search: anchor, replace: anchor + addition }], explanation: `Lists ${missing.join(', ')} as explicit cases that do nothing, as before.`, by: 'quick fix' };
    }

    // C-like switch: find its block and a case label to copy the spelling from.
    const braceStart = text.indexOf('{', start);
    if (braceStart < 0) return undefined;
    const braceEnd = matching(text, braceStart, '{', '}');
    if (braceEnd < 0) return undefined;
    const body = text.slice(braceStart + 1, braceEnd);
    const caseMatch = /\bcase\s+((?:[^:\n]|::)+?)\s*(->|:(?!:))/.exec(body);
    if (!caseMatch) return undefined;
    const template = caseMatch[1].trim();
    const arrow = caseMatch[2] === '->';
    const firstValue = sw.cases[0];
    const caseLine = body.slice(0, caseMatch.index).split('\n').pop() ?? '';
    const indent = /^(\s*)/.exec(caseLine)![1] || '    ';
    const labels = missing.map(v => spell(template, firstValue, v));
    const note = 'pflow: these states were not handled before either: decide what they should do';
    let addition: string;
    if (arrow) addition = `${indent}case ${labels.join(', ')} -> { } // ${note}\n`;
    else if (ext === 'go') addition = `${indent}case ${labels.join(', ')}:\n${indent}\t// ${note}\n`;
    else addition = `${labels.map(l => `${indent}case ${l}:`).join('\n')}\n${indent}    break; // ${note}\n`;
    // Insert before the line holding the switch's closing brace (or just before the brace).
    const lineStart = text.lastIndexOf('\n', braceEnd) + 1;
    const ownLine = /^\s*$/.test(text.slice(lineStart, braceEnd));
    const insertAt = ownLine ? lineStart : braceEnd;
    const search = text.slice(start, braceEnd + 1);
    const replace = text.slice(start, insertAt) + (ownLine ? addition : `\n${addition}`) + text.slice(insertAt, braceEnd + 1);
    if (text.split(search).length !== 2) return undefined;
    return { finding: f, edits: [{ file, search, replace }], explanation: `Lists ${missing.join(', ')} as explicit cases that do nothing, as before (make the choice visible).`, by: 'quick fix' };
}

/** `if (<state> !== <value before the await>) return;` just before the write. */
function recheckAfterAwait(f: Finding, facts: Facts, text: string): Proposal | undefined {
    const w = facts.writes.find(x => x.loc.file === f.loc!.file && x.loc.line === f.loc!.line);
    if (!w?.sources || w.sources.length === 0) return undefined;
    const lines = text.split('\n');
    const line = lines[w.loc.line - 1];
    const file = f.loc!.file;
    const python = file.endsWith('.py');
    const indent = /^(\s*)/.exec(line)![1];
    let read: string | undefined;
    let valueText: string | undefined;
    const signal = /^\s*((?:this\.)?[\w$.]+)\.(set|next)\((.+)\);?\s*$/.exec(line);
    const assign = /^\s*((?:this\.|self\.)?[\w$.]+)\s*=\s*([^=].*?);?\s*$/.exec(line);
    if (signal) {
        read = signal[2] === 'next' ? `${signal[1]}.getValue()` : `${signal[1]}()`;
        valueText = signal[3];
    } else if (assign) {
        read = assign[1];
        valueText = assign[2];
    }
    if (!read || !valueText) return undefined;
    const target = w.targets?.[0];
    const spellValue = (v: string) => (target ? spell(valueText!.trim(), target, v) : `'${v}'`);
    const values = w.sources.map(spellValue);
    let guard: string;
    if (python) guard = values.length === 1 ? `${indent}if ${read} != ${values[0]}:\n${indent}    return` : `${indent}if ${read} not in (${values.join(', ')}):\n${indent}    return`;
    else guard = values.length === 1 ? `${indent}if (${read} !== ${values[0]}) return;` : `${indent}if (![${values.join(', ')}].includes(${read})) return;`;
    const note = python ? '  # the state may have changed while awaiting' : ' // the state may have changed while awaiting';
    const search = `${lines[w.loc.line - 2] ?? ''}\n${line}`;
    const replace = `${lines[w.loc.line - 2] ?? ''}\n${guard}${note}\n${line}`;
    return { finding: f, edits: [{ file, search, replace }], explanation: `Re-checks that ${w.variable.replace(/^.*#/, '')} is still ${w.sources.join(' or ')} after the await before writing.`, by: 'quick fix' };
}

const RELEASE: Partial<Record<ResourceKind, (handle: string) => string>> = {
    interval: h => `clearInterval(${h});`,
    timeout: h => `clearTimeout(${h});`,
    'event-source': h => `${h}?.close();`,
    observer: h => `${h}?.disconnect();`,
    subscription: h => `${h}?.unsubscribe();`,
    graph: h => `${h}?.destroy();`
};

/** Release before acquiring again; release when disposed (TypeScript/JavaScript). */
function releaseResource(f: Finding, facts: Facts, models: ExtractedModel[], text: string): Proposal | undefined {
    const file = f.loc!.file;
    if (!/\.(ts|tsx|mts|cts|js|mjs)$/.test(file)) return undefined;
    const model = models.find(m => m.id === f.model);
    const acquire = facts.resources.find(r => r.op === 'acquire' && r.loc.file === file && r.loc.line === f.loc!.line);
    if (!model || !acquire?.handle || !/^this\.\w+$/.test(acquire.handle)) return undefined;
    const release = RELEASE[acquire.kind]?.(acquire.handle);
    if (!release) return undefined;
    const edits: Edit[] = [];
    const explanation: string[] = [];
    const lines = text.split('\n');
    const reacquire = (model.evidence['held->leaked'] ?? []).some(e => !/discarded|ngOnDestroy|dispose|destroy/i.test(e.event));
    if (reacquire) {
        const line = lines[acquire.loc.line - 1];
        const indent = /^(\s*)/.exec(line)![1];
        edits.push({ file, search: `${lines[acquire.loc.line - 2] ?? ''}\n${line}`, replace: `${lines[acquire.loc.line - 2] ?? ''}\n${indent}${release} // release the previous one before acquiring again\n${line}` });
        explanation.push(`Releases the previous ${acquire.kind} (${release}) before acquiring a new one.`);
    }
    const discarded = (model.evidence['held->leaked'] ?? []).some(e => /discarded/.test(e.event));
    const cls = facts.classes.find(c => c.id === acquire.owner);
    if (discarded && cls) {
        const classStart = offsetOfLine(text, cls.loc.line);
        const brace = text.indexOf('{', classStart);
        const end = brace >= 0 ? matching(text, brace, '{', '}') : -1;
        if (end > 0) {
            const angular = cls.decorators.some(d => /^(Component|Directive)$/.test(d));
            const name = angular ? 'ngOnDestroy' : 'dispose';
            const memberIndent = /\n([ \t]+)\S/.exec(text.slice(brace, end))?.[1] ?? '    ';
            const lineStart = text.lastIndexOf('\n', end) + 1;
            const ownLine = /^\s*$/.test(text.slice(lineStart, end));
            const insertAt = ownLine ? lineStart : end;
            const method = `\n${memberIndent}/** Releases what the object holds (added by pflow: it was lost when the object was discarded). */\n${memberIndent}${name}(): void {\n${memberIndent}    ${release}\n${memberIndent}}\n`;
            const search = text.slice(classStart, end + 1);
            // The class text is replaced whole: combine with the first edit when it is inside the class.
            const current = edits.length > 0 && search.includes(edits[0].search) ? search.replace(edits[0].search, edits[0].replace) : search;
            const offset = current.length - search.length;
            const at = insertAt - classStart + (edits.length > 0 && search.includes(edits[0].search) ? offset : 0);
            const replace = current.slice(0, at) + (ownLine ? method : `\n${method}`) + current.slice(at);
            if (text.split(search).length === 2) {
                if (edits.length > 0 && search.includes(edits[0].search)) edits.splice(0, 1);
                edits.push({ file, search, replace });
                explanation.push(`Adds ${name}() releasing it when the ${cls.name} is disposed${angular ? ' (Angular calls ngOnDestroy)' : ' (call it when the object is no longer used)'}.`);
            }
        }
    }
    if (edits.length === 0) return undefined;
    return { finding: f, edits, explanation: explanation.join(' '), by: 'quick fix' };
}

// ---------------------------------------------------------------- helpers

/** A label/value written like `template` (which spells `known`), for another value: 'x' -> 'y', State.X -> State.Y, State::X -> State::Y. */
function spell(template: string, known: string, value: string): string {
    const t = template.trim();
    if (t.includes(known)) return t.replace(known, value);
    const q = /^(.*?(?:\.|::|->))\w+$/.exec(t);
    if (q) return `${q[1]}${value}`;
    if (/^(["'`]).*\1$/.test(t)) return `${t[0]}${value}${t[0]}`;
    return value;
}

function offsetOfLine(text: string, line: number): number {
    let offset = 0;
    for (let i = 1; i < line; i++) offset = text.indexOf('\n', offset) + 1;
    return offset;
}

/** Index of the bracket matching the one at `open`, skipping strings and comments. */
function matching(text: string, open: number, openChar: string, closeChar: string): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (c === '"' || c === "'" || c === '`') {
            const quote = c;
            for (i++; i < text.length && text[i] !== quote; i++) if (text[i] === '\\') i++;
            continue;
        }
        if (c === '/' && text[i + 1] === '/') {
            i = text.indexOf('\n', i);
            if (i < 0) return -1;
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            i = text.indexOf('*/', i + 2) + 1;
            if (i <= 0) return -1;
            continue;
        }
        if (c === openChar) depth++;
        else if (c === closeChar && --depth === 0) return i;
    }
    return -1;
}

export function readSafe(path: string): string | undefined {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return undefined;
    }
}

/** A unified diff of two texts (line based, small context). */
export function lineDiff(file: string, before: string, after: string): string {
    const a = before.split('\n');
    const b = after.split('\n');
    // Longest common subsequence on lines (files are small enough; bounded for safety).
    if (a.length * b.length > 4_000_000) return `--- a/${file}\n+++ b/${file}\n(file too large for a line diff)\n`;
    const n = a.length;
    const m = b.length;
    const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    const ops: Array<{ op: ' ' | '-' | '+'; line: string; ai: number; bi: number }> = [];
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
        if (i < n && j < m && a[i] === b[j]) ops.push({ op: ' ', line: a[i], ai: i++, bi: j++ });
        else if (j < m && (i >= n || lcs[i][j + 1] > lcs[i + 1][j])) ops.push({ op: '+', line: b[j], ai: i, bi: j++ });
        else ops.push({ op: '-', line: a[i], ai: i++, bi: j });
    }
    const out = [`--- a/${file}`, `+++ b/${file}`];
    const context = 3;
    for (let k = 0; k < ops.length; k++) {
        if (ops[k].op === ' ') continue;
        let s = Math.max(0, k - context);
        let e = k;
        while (e < ops.length && (ops[e].op !== ' ' || ops.slice(e, e + context * 2).some(o => o.op !== ' '))) e++;
        e = Math.min(ops.length, e + context);
        const hunk = ops.slice(s, e);
        const aStart = hunk[0].ai + 1;
        const bStart = hunk[0].bi + 1;
        out.push(`@@ -${aStart},${hunk.filter(o => o.op !== '+').length} +${bStart},${hunk.filter(o => o.op !== '-').length} @@`);
        for (const o of hunk) out.push(`${o.op}${o.line}`);
        k = e - 1;
        s = e;
    }
    return out.join('\n') + '\n';
}
