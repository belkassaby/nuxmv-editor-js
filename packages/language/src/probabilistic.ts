import type { Expression } from './generated/ast.js';
import type { DiagramModel } from './model.js';
import { parseDiagram } from './parse.js';
import { evaluate, Semantics, type Configuration, type Valuation } from './semantics.js';
import { serializeDiagram } from './serializer.js';

/**
 * Discrete-time Markov chain of a diagram: the configurations (state +
 * variables) reachable from the initial ones, with the transition
 * probabilities given by `prob`. In a configuration, the probabilities of the
 * enabled transitions are used as given; enabled transitions without one share
 * what is left (all of it if none has one); the total is normalised to 1.
 * A configuration where nothing is enabled stutters with probability 1.
 */
export interface Dtmc {
    configurations: Configuration[];
    /** Outgoing distribution of each configuration: [target index, probability, transition index | null]. */
    successors: Array<Array<[number, number, number | null]>>;
    initial: number[];
    /** True when some configuration had to fill in or normalise probabilities. */
    normalised: boolean;
    truncated: boolean;
}

export async function buildDtmc(model: DiagramModel, maxStates = 50_000): Promise<{ dtmc: Dtmc; semantics: Semantics }> {
    const semantics = await Semantics.of(model);
    const configurations: Configuration[] = [];
    const index = new Map<string, number>();
    const add = (c: Configuration) => {
        const k = JSON.stringify(c);
        let i = index.get(k);
        if (i === undefined) {
            i = configurations.length;
            index.set(k, i);
            configurations.push(c);
        }
        return i;
    };
    const initial = semantics.initialConfigurations().map(add);
    const successors: Dtmc['successors'] = [];
    let normalised = false;
    for (let i = 0; i < configurations.length && configurations.length <= maxStates; i++) {
        const c = configurations[i];
        const next = semantics.successors(c);
        const given = next.filter(n => n.transition !== null && model.transitions[n.transition].probability !== undefined);
        const sumGiven = given.reduce((s, n) => s + (model.transitions[n.transition!].probability ?? 0), 0);
        const missing = next.length - given.length;
        const share = missing > 0 ? Math.max(0, 1 - sumGiven) / missing : 0;
        let weights = next.map(n => (n.transition !== null && model.transitions[n.transition].probability !== undefined ? model.transitions[n.transition].probability! : n.transition === null ? 1 : share));
        let total = weights.reduce((a, b) => a + b, 0);
        if (total <= 0) {
            weights = next.map(() => 1);
            total = next.length;
        }
        if (next.length > 1 && (missing > 0 || Math.abs(sumGiven - 1) > 1e-9)) normalised = true;
        const dist = new Map<number, [number, number, number | null]>();
        next.forEach((n, k) => {
            const target = add(n.config);
            const p = weights[k] / total;
            const prev = dist.get(target);
            dist.set(target, prev ? [target, prev[1] + p, prev[2]] : [target, p, n.transition]);
        });
        successors.push([...dist.values()]);
    }
    return { dtmc: { configurations, successors, initial, normalised, truncated: configurations.length > maxStates }, semantics };
}

export type ProbabilisticQuery =
    | { kind: 'reach'; target: string; bound?: number }
    | { kind: 'steps'; target: string }
    | { kind: 'visits'; count: string; target: string };

export interface ProbabilisticResult {
    query: ProbabilisticQuery;
    /** Value from the (first) initial configuration. */
    value: number;
    /** P(reach target) when the query needs it (expected values are only finite when it is 1). */
    reachProbability?: number;
    description: string;
}

/**
 * Probability of eventually (or within `bound` steps) reaching a
 * configuration satisfying `target`; expected number of steps to reach it;
 * expected number of visits to configurations satisfying `count` before
 * reaching `target` (e.g. expected retries before merging).
 */
export async function analyse(model: DiagramModel, queries: ProbabilisticQuery[]): Promise<{ dtmc: Dtmc; results: ProbabilisticResult[] }> {
    const { dtmc, semantics } = await buildDtmc(model);
    const predicate = await compilePredicates(model, queries.flatMap(q => (q.kind === 'visits' ? [q.target, q.count] : [q.target])));
    const holds = (expr: string) => dtmc.configurations.map(c => predicate(expr, semantics.valuation(c)));
    const results = queries.map(q => {
        const target = holds(q.target);
        const reach = reachability(dtmc, target);
        const start = dtmc.initial[0] ?? 0;
        if (q.kind === 'reach') {
            const v = q.bound !== undefined ? bounded(dtmc, target, q.bound)[start] : reach[start];
            return { query: q, value: v, description: `P(${q.bound !== undefined ? `F<=${q.bound}` : 'F'} ${q.target}) = ${fmt(v)}` };
        }
        if (q.kind === 'steps') {
            const v = reach[start] < 1 - 1e-9 ? Infinity : expected(dtmc, target, dtmc.configurations.map(() => 1))[start];
            return { query: q, value: v, reachProbability: reach[start], description: `E[steps until ${q.target}] = ${fmt(v)}${reach[start] < 1 - 1e-9 ? ` (the target is reached with probability ${fmt(reach[start])} only)` : ''}` };
        }
        const counted = holds(q.count).map(b => (b ? 1 : 0));
        const v = expected(dtmc, target, counted, true)[start];
        return { query: q, value: v, reachProbability: reach[start], description: `E[visits to ${q.count} before ${q.target}] = ${fmt(v)}` };
    });
    return { dtmc, results };
}

async function compilePredicates(model: DiagramModel, expressions: string[]): Promise<(expr: string, v: Valuation) => boolean> {
    const unique = [...new Set(expressions)];
    const text = serializeDiagram({ ...model, specs: unique.map((e, i) => ({ kind: 'INVARSPEC', name: `q${i}`, expression: e })) });
    const parsed = await parseDiagram(text);
    const errors = parsed.diagnostics.filter(d => d.severity === 'error' && /q\d+|INVARSPEC/.test(text.split('\n')[d.line - 1] ?? ''));
    if (errors.length > 0) throw new Error(errors.map(e => e.message).join(' '));
    const specs = parsed.ast.elements.filter(e => e.$type === 'Specification');
    const names = new Set([...model.attributes.map(a => a.name), ...model.variables.map(v => v.name)]);
    const byText = new Map<string, Expression>();
    unique.forEach((e, i) => {
        const node = specs[specs.length - unique.length + i];
        if (node?.$type === 'Specification') byText.set(e, node.expression);
    });
    return (expr, v) => evaluate(byText.get(expr)!, v, names) === true;
}

/** Graph precomputation + Gauss-Seidel: P(F target) for every configuration. */
function reachability(d: Dtmc, target: boolean[]): number[] {
    const n = d.configurations.length;
    // States that can reach the target at all (backward search); the others have probability 0.
    const pred: number[][] = Array.from({ length: n }, () => []);
    d.successors.forEach((succ, i) => succ.forEach(([t]) => pred[t].push(i)));
    const canReach = new Array<boolean>(n).fill(false);
    const stack = target.map((t, i) => (t ? i : -1)).filter(i => i >= 0);
    stack.forEach(i => (canReach[i] = true));
    while (stack.length > 0) {
        for (const p of pred[stack.pop()!]) {
            if (!canReach[p]) {
                canReach[p] = true;
                stack.push(p);
            }
        }
    }
    const x: number[] = target.map(t => (t ? 1 : 0));
    for (let iter = 0; iter < 100_000; iter++) {
        let delta = 0;
        for (let i = 0; i < n; i++) {
            if (target[i] || !canReach[i]) continue;
            let v = 0;
            for (const [t, p] of d.successors[i] ?? []) v += p * x[t];
            delta = Math.max(delta, Math.abs(v - x[i]));
            x[i] = v;
        }
        if (delta < 1e-12) break;
    }
    return x;
}

function bounded(d: Dtmc, target: boolean[], k: number): number[] {
    let x: number[] = target.map(t => (t ? 1 : 0));
    for (let step = 0; step < k; step++) {
        x = x.map((_, i) => (target[i] ? 1 : (d.successors[i] ?? []).reduce((s, [t, p]) => s + p * x[t], 0)));
    }
    return x;
}

/** Expected accumulated reward until the target (reward per configuration left). */
function expected(d: Dtmc, target: boolean[], reward: number[], visits = false): number[] {
    const n = d.configurations.length;
    const reach = reachability(d, target);
    const x = new Array<number>(n).fill(0);
    for (let iter = 0; iter < 200_000; iter++) {
        let delta = 0;
        for (let i = 0; i < n; i++) {
            if (target[i]) continue;
            if (!visits && reach[i] < 1 - 1e-9) {
                x[i] = Infinity;
                continue;
            }
            let v = reward[i];
            for (const [t, p] of d.successors[i] ?? []) v += p * (Number.isFinite(x[t]) ? x[t] : 0);
            delta = Math.max(delta, Math.abs(v - x[i]));
            x[i] = v;
        }
        if (delta < 1e-12) break;
    }
    return x;
}

function fmt(v: number): string {
    return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : '∞';
}

// ---------------------------------------------------------------------------
// PRISM export
// ---------------------------------------------------------------------------

/**
 * The same chain in the PRISM language (explicit states), with a label per
 * diagram state and per boolean attribute, and a properties file. Runs in
 * PRISM and Storm, which add full PCTL, rewards and steady-state analysis.
 */
export async function exportPrism(model: DiagramModel, queries: ProbabilisticQuery[] = []): Promise<{ model: string; properties: string }> {
    const { dtmc, semantics } = await buildDtmc(model);
    const n = dtmc.configurations.length;
    const lines: string[] = [];
    lines.push(`// ${model.name ?? 'main'}: DTMC generated by nuxmv-editor-js (${n} configurations of state + variables).`);
    lines.push('dtmc');
    lines.push('');
    lines.push(`module ${ident(model.name ?? 'main')}`);
    lines.push(`    c : [0..${Math.max(0, n - 1)}] init ${dtmc.initial[0] ?? 0};`);
    dtmc.successors.forEach((succ, i) => {
        const c = dtmc.configurations[i];
        const vars = Object.entries(c.variables).map(([k, v]) => `${k}=${String(v)}`).join(', ');
        lines.push(`    // ${i}: ${c.state}${vars ? ` (${vars})` : ''}`);
        lines.push(`    [] c=${i} -> ${succ.map(([t, p]) => `${p}:(c'=${t})`).join(' + ')};`);
    });
    lines.push('endmodule');
    lines.push('');
    for (const s of model.states) {
        const where = dtmc.configurations.map((c, i) => (c.state === s.name ? i : -1)).filter(i => i >= 0);
        lines.push(`label "${s.name}" = ${where.length ? where.map(i => `c=${i}`).join(' | ') : 'false'};`);
    }
    const booleans = [...model.attributes, ...model.variables].filter(a => a.type.kind === 'boolean');
    for (const b of booleans) {
        const where = dtmc.configurations.map((c, i) => (semantics.valuation(c)[b.name] === true ? i : -1)).filter(i => i >= 0);
        lines.push(`label "${b.name}" = ${where.length ? where.map(i => `c=${i}`).join(' | ') : 'false'};`);
    }
    const props: string[] = ['// Probability and expected steps to reach each final-looking state; edit freely.'];
    const predicate = queries.length ? await compilePredicates(model, queries.flatMap(q => (q.kind === 'visits' ? [q.target, q.count] : [q.target]))) : null;
    const labelFor = (expr: string) => {
        const where = dtmc.configurations.map((c, i) => (predicate!(expr, semantics.valuation(c)) ? i : -1)).filter(i => i >= 0);
        return where.length ? `(${where.map(i => `c=${i}`).join(' | ')})` : 'false';
    };
    for (const q of queries) {
        props.push(`// ${q.kind === 'reach' ? `P(F${q.bound !== undefined ? `<=${q.bound}` : ''} ${q.target})` : q.kind === 'steps' ? `E[steps until ${q.target}]` : `E[visits to ${q.count} before ${q.target}]`}`);
        if (q.kind === 'reach') props.push(`P=? [ F${q.bound !== undefined ? `<=${q.bound}` : ''} ${labelFor(q.target)} ]`);
        else if (q.kind === 'steps') props.push(`R{"steps"}=? [ F ${labelFor(q.target)} ]`);
        else props.push(`R{"${ident(q.count)}"}=? [ F ${labelFor(q.target)} ]`);
    }
    if (queries.some(q => q.kind === 'steps')) lines.push('', 'rewards "steps"', '    true : 1;', 'endrewards');
    for (const q of queries) {
        if (q.kind !== 'visits') continue;
        lines.push('', `rewards "${ident(q.count)}"`, `    ${labelFor(q.count)} : 1;`, 'endrewards');
    }
    return { model: lines.join('\n') + '\n', properties: props.join('\n') + '\n' };
}

function ident(s: string): string {
    return s.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^([0-9])/, '_$1') || 'm';
}
