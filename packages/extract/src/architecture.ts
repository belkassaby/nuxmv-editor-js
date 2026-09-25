/**
 * Architecture: the import graph between layers (or top-level packages).
 * The layer graph becomes a model whose transitions are "imports", so nuXmv
 * checks transitive rules: a layer only reaches the layers it may use, and
 * no layer depends on itself through others (cycles). Deep imports that
 * bypass a package's entry module (its facade) and file-level cycles are
 * found directly on the graph.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ProvenflowConfig } from './config.js';
import { formatLocation, type Facts, type ImportFact, type Location } from './ir.js';
import { ModelBuilder, type ExtractedModel, type Finding } from './models.js';
import { partition } from './paradigm.js';
import type { PatternInstance } from './patterns.js';

export interface ArchitectureResult {
    models: ExtractedModel[];
    findings: Finding[];
    /** Layer -> layers it imports, with one example import each. */
    edges: Array<{ from: string; to: string; count: number; example: Location; typeOnly: boolean }>;
    facades: PatternInstance[];
}

export function analyseArchitecture(facts: Facts, config: ProvenflowConfig): ArchitectureResult {
    const findings: Finding[] = [];
    const parts = partition(facts, config.layers);
    const layerOf = new Map<string, string>();
    for (const [name, part] of parts) for (const f of part.files) layerOf.set(f, name);
    const layers = new Map((config.layers ?? []).map(l => [l.name, l]));

    // ---- layer edges
    const edgeMap = new Map<string, { from: string; to: string; count: number; example: Location; typeOnly: boolean; imports: Array<ImportFact & { file: string }> }>();
    for (const m of facts.modules) {
        if (m.isTest) continue;
        const from = layerOf.get(m.file);
        if (!from) continue;
        for (const imp of m.imports) {
            const target = imp.resolved && sourceOf(imp.resolved, layerOf);
            const to = target ? layerOf.get(target) : undefined;
            if (!to || to === from) continue;
            const key = `${from}->${to}`;
            const edge = edgeMap.get(key) ?? { from, to, count: 0, example: imp.loc, typeOnly: true, imports: [] };
            edge.count++;
            edge.typeOnly &&= imp.typeOnly;
            edge.imports.push({ ...imp, file: m.file });
            edgeMap.set(key, edge);
        }
    }
    const edges = [...edgeMap.values()];

    // ---- model of the layer graph
    const models: ExtractedModel[] = [];
    const names = [...parts.keys()].filter(n => n !== '(no layer)');
    if (names.length > 1) {
        const b = new ModelBuilder('architecture', 'architecture', 'layer dependencies');
        for (const n of names) b.state(n, true);
        b.state('end');
        for (const n of names) b.transition(n, 'end', { event: 'no further import' });
        for (const e of edges.filter(e => names.includes(e.from) && names.includes(e.to))) {
            b.transition(e.from, e.to, { event: `${e.count} import(s)${e.typeOnly ? ', types only' : ''}`, loc: e.example, text: e.imports[0]?.specifier });
        }
        // Direct rules are checked on the import graph below (with the offending imports);
        // the model checks what only shows transitively: a layer reaching itself again.
        for (const n of names) {
            const id = b.idOf(n)!;
            const example = edges.find(e => e.from === n)?.example;
            b.spec('CTLSPEC', `no_cycle_${id}`, `AG (state = ${id} -> AX !(EF state = ${id}))`, {
                rule: 'layer-cycle',
                category: 'architecture',
                severity: 'error',
                message: `${n} depends on itself through other layers: the counterexample lists the import chain.`,
                fix: 'Break the cycle: move the shared code into a lower layer both can import, or invert the dependency with an interface owned by the lower layer.',
                loc: example,
                fallback: 'no-return',
                states: [n]
            });
        }
        models.push(b.build());
    }

    // ---- direct layer violations, with the offending imports
    for (const e of edges) {
        const allowed = layers.get(e.from)?.mayImport;
        if (!allowed || allowed.includes(e.to)) continue;
        findings.push({
            rule: 'layer-violation',
            category: 'architecture',
            severity: e.typeOnly ? 'warning' : 'error',
            subject: `${e.from} -> ${e.to}`,
            message: `${e.from} imports ${e.to}${e.typeOnly ? ' (types only)' : ''} in ${e.count} place(s), but may only import ${allowed.join(', ') || 'nothing'}: ${e.imports.slice(0, 3).map(i => `${i.specifier} (${formatLocation(i.loc)})`).join(', ')}.`,
            fix: `Remove these imports, or move what ${e.from} needs into ${allowed[0] ?? 'its own layer'}${e.typeOnly ? '; for types, define them in the lower layer' : ''}.`,
            loc: e.example,
            related: e.imports.slice(1, 6).map(i => i.loc),
            model: 'architecture',
            source: 'graph'
        });
    }

    // ---- facades: other packages are used through their entry module
    const facades: PatternInstance[] = [];
    const packageOf = packageRoots(facts);
    for (const [root, entry] of packageOf.entries) facades.push({ pattern: 'facade', subject: root || '.', loc: { file: entry, line: 1 }, evidence: `entry module ${entry}` });
    if (config.packageEntries !== false) {
        for (const m of facts.modules) {
            const own = packageOf.of(m.file);
            for (const imp of m.imports) {
                if (!imp.resolved) continue;
                const target = sourceOf(imp.resolved, layerOf) ?? imp.resolved;
                const other = packageOf.of(target);
                if (other === undefined || other === own) continue;
                const entry = packageOf.entries.get(other);
                if (!entry || sameModule(target, entry) || /(^|\/)index\.[^/]+$|__init__\.py$/.test(target)) continue;
                findings.push({
                    rule: 'facade-bypassed',
                    category: 'architecture',
                    severity: 'warning',
                    subject: `${m.file} -> ${other}`,
                    message: `${m.file} reaches into ${other} (${imp.specifier}) instead of importing its entry module ${entry}.`,
                    fix: `Import from the package entry (${entry}); if the symbol is not exported there, export it from the entry.`,
                    loc: imp.loc,
                    source: 'graph'
                });
            }
        }
    }

    // ---- file-level import cycles
    for (const cycle of fileCycles(facts, layerOf)) {
        findings.push({
            rule: 'import-cycle',
            category: 'architecture',
            severity: 'warning',
            subject: cycle[0],
            message: `Import cycle between ${cycle.length} files: ${cycle.join(' -> ')} -> ${cycle[0]}.`,
            fix: 'Move what the files share into a new module both import, or make one of the imports type-only.',
            loc: { file: cycle[0], line: 1 },
            source: 'graph'
        });
    }
    return { models, findings, edges: edges.map(({ imports: _imports, ...e }) => e), facades };
}

/** Compiled output (out/x.d.ts, dist/x.js) maps back to the source file it came from. */
function sourceOf(resolved: string, known: Map<string, string>): string | undefined {
    if (known.has(resolved)) return resolved;
    const candidates = [resolved.replace(/\/(out|dist|build|lib)\//, '/src/').replace(/\.d\.ts$|\.js$/, '.ts'), resolved.replace(/\.js$/, '.ts'), resolved.replace(/\.d\.ts$/, '.ts')];
    return candidates.find(c => known.has(c));
}

function sameModule(a: string, b: string): boolean {
    const strip = (s: string) => s.replace(/\.(d\.ts|ts|tsx|js|mjs|py)$/, '').replace(/\/(out|dist|build|lib)\//, '/src/');
    return strip(a) === strip(b);
}

/** Package folders (with a package.json or pyproject.toml) and their entry module. */
function packageRoots(facts: Facts): { entries: Map<string, string>; of: (file: string) => string | undefined } {
    const entries = new Map<string, string>();
    const dirs = new Set<string>();
    for (const f of facts.files) {
        let dir = dirname(f);
        while (dir && dir !== '.') {
            dirs.add(dir);
            dir = dirname(dir);
        }
    }
    const roots: string[] = [];
    for (const dir of dirs) {
        const pkg = join(facts.root, dir, 'package.json');
        if (existsSync(pkg)) {
            roots.push(dir);
            try {
                const json = JSON.parse(readFileSync(pkg, 'utf8')) as { main?: string; types?: string };
                const main = json.types ?? json.main;
                const source = main ? main.replace(/^\.\//, '').replace(/^(out|dist|build|lib)\//, 'src/').replace(/\.d\.ts$|\.js$/, '.ts') : 'src/index.ts';
                const entry = `${dir}/${source}`;
                if (facts.files.includes(entry)) entries.set(dir, entry);
            } catch {
                // unreadable package.json: no entry
            }
        } else if (existsSync(join(facts.root, dir, '__init__.py')) && !existsSync(join(facts.root, dirname(dir), '__init__.py'))) {
            roots.push(dir);
            entries.set(dir, `${dir}/__init__.py`);
        }
    }
    roots.sort((a, b) => b.length - a.length);
    return { entries, of: file => roots.find(r => file.startsWith(`${r}/`)) };
}

/** Strongly connected components of the file import graph (value imports only). */
function fileCycles(facts: Facts, known: Map<string, string>): string[][] {
    const graph = new Map<string, string[]>();
    for (const m of facts.modules) {
        if (m.isTest) continue;
        graph.set(m.file, m.imports.filter(i => i.resolved && !i.typeOnly).map(i => sourceOf(i.resolved!, known) ?? i.resolved!).filter(f => f !== m.file));
    }
    let index = 0;
    const indices = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const cycles: string[][] = [];
    const strongConnect = (v: string) => {
        indices.set(v, index);
        low.set(v, index++);
        stack.push(v);
        onStack.add(v);
        for (const w of graph.get(v) ?? []) {
            if (!graph.has(w)) continue;
            if (!indices.has(w)) {
                strongConnect(w);
                low.set(v, Math.min(low.get(v)!, low.get(w)!));
            } else if (onStack.has(w)) {
                low.set(v, Math.min(low.get(v)!, indices.get(w)!));
            }
        }
        if (low.get(v) === indices.get(v)) {
            const component: string[] = [];
            let w: string;
            do {
                w = stack.pop()!;
                onStack.delete(w);
                component.push(w);
            } while (w !== v);
            if (component.length > 1) cycles.push(component.reverse());
        }
    };
    for (const v of graph.keys()) if (!indices.has(v)) strongConnect(v);
    return cycles;
}
