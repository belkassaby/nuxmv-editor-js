import { isBinaryExpression, isBooleanLiteral, isNameReference, isNumberLiteral, isPathQuantifiedExpression, isStateVariable, isUnaryExpression, type Diagram, type Expression } from './generated/ast.js';
import type { DiagramModel, TransitionDef } from './model.js';
import { parseDiagram } from './parse.js';
import { serializeDiagram } from './serializer.js';

/** A value of the model: booleans, integers and enumeration symbols (or undefined when free). */
export type Value = boolean | number | string | undefined;
export type Valuation = Record<string, Value>;

/** A configuration of the running machine: control state plus data variables. */
export interface Configuration {
    state: string;
    variables: Valuation;
}

export class EvaluationError extends Error {}

/**
 * Executable semantics of a diagram, shared by the simulator, the trace
 * conformance checker and the tests. It follows the nuXmv encoding exactly:
 * a transition is enabled when its guard holds and its updates stay in range;
 * when none is enabled the machine stutters.
 */
export class Semantics {
    private readonly guards: Array<Expression | undefined>;
    private readonly updates: Array<Array<{ variable: string; value: Expression }>>;
    private readonly names = new Set<string>();

    private constructor(
        readonly model: DiagramModel,
        ast: Diagram
    ) {
        const transitions = ast.elements.filter(e => e.$type === 'Transition');
        this.guards = transitions.map(t => t.guard);
        this.updates = transitions.map(t => t.updates.map(u => ({ variable: u.variable.ref?.name ?? u.variable.$refText, value: u.value })));
        for (const a of model.attributes) this.names.add(a.name);
        for (const v of model.variables) this.names.add(v.name);
    }

    static async of(model: DiagramModel): Promise<Semantics> {
        const parsed = await parseDiagram(serializeDiagram(model));
        return new Semantics(model, parsed.ast);
    }

    initialConfigurations(): Configuration[] {
        const initial = this.model.states.filter(s => s.initial).map(s => s.name);
        const names = initial.length > 0 ? initial : this.model.states.slice(0, 1).map(s => s.name);
        const variables: Valuation = {};
        for (const v of this.model.variables) variables[v.name] = literal(v.initial, v.type.kind);
        return names.map(state => ({ state, variables: { ...variables } }));
    }

    /** Attribute values of a state plus the variables: what properties and guards see. */
    valuation(config: Configuration): Valuation {
        const s = this.model.states.find(x => x.name === config.state);
        const v: Valuation = { state: config.state };
        for (const a of this.model.attributes) v[a.name] = s?.values[a.name] !== undefined ? literal(s.values[a.name], a.type.kind) : undefined;
        return { ...v, ...config.variables };
    }

    /** Indices of the transitions enabled in a configuration. */
    enabled(config: Configuration): number[] {
        const result: number[] = [];
        this.model.transitions.forEach((t, i) => {
            if (t.source === config.state && this.isEnabled(i, config)) result.push(i);
        });
        return result;
    }

    isEnabled(index: number, config: Configuration): boolean {
        const t = this.model.transitions[index];
        if (!t || t.source !== config.state) return false;
        const v = this.valuation(config);
        const guard = this.guards[index];
        if (guard && !truthy(this.evaluate(guard, v))) return false;
        return this.nextVariables(index, v) !== null;
    }

    /** Fires a transition (it must be enabled). */
    fire(index: number, config: Configuration): Configuration {
        const t = this.model.transitions[index];
        const next = this.nextVariables(index, this.valuation(config));
        if (!t || !next || !this.isEnabled(index, config)) throw new EvaluationError(`Transition ${index} is not enabled in ${config.state}.`);
        return { state: t.target, variables: next };
    }

    /** Successor configurations; a configuration with nothing enabled stutters. */
    successors(config: Configuration): Array<{ transition: number | null; config: Configuration }> {
        const enabled = this.enabled(config);
        if (enabled.length === 0) return [{ transition: null, config }];
        return enabled.map(i => ({ transition: i, config: this.fire(i, config) }));
    }

    transition(index: number): TransitionDef {
        return this.model.transitions[index];
    }

    private nextVariables(index: number, v: Valuation): Valuation | null {
        const next: Valuation = {};
        for (const variable of this.model.variables) next[variable.name] = v[variable.name];
        for (const u of this.updates[index] ?? []) {
            const value = this.evaluate(u.value, v);
            const def = this.model.variables.find(x => x.name === u.variable);
            if (def?.type.kind === 'range' && (typeof value !== 'number' || value < def.type.low || value > def.type.high)) return null;
            next[u.variable] = value;
        }
        return next;
    }

    /** Evaluates a present-time expression. */
    evaluate(e: Expression, v: Valuation): Value {
        return evaluate(e, v, this.names);
    }
}

/** Evaluates an expression over the current valuation (no temporal operators). */
export function evaluate(e: Expression, v: Valuation, names: Set<string>): Value {
    if (isBooleanLiteral(e)) return e.value === 'TRUE';
    if (isNumberLiteral(e)) return e.value;
    if (isStateVariable(e)) return v['state'];
    if (isNameReference(e)) return names.has(e.name) ? v[e.name] : e.name;
    if (isPathQuantifiedExpression(e)) throw new EvaluationError('CTL path quantifiers cannot be evaluated on one state.');
    if (isUnaryExpression(e)) {
        if (e.operator === '!') return !truthy(evaluate(e.operand, v, names));
        if (e.operator === '-') return -num(evaluate(e.operand, v, names));
        throw new EvaluationError(`Temporal operator ${e.operator} needs a trace.`);
    }
    if (isBinaryExpression(e)) return applyBinary(e.operator, () => evaluate(e.left, v, names), () => evaluate(e.right, v, names));
    throw new EvaluationError('Unsupported expression.');
}

/** Propositional and arithmetic operators; the operands are evaluated lazily (short-circuit). */
export function applyBinary(op: string, a: () => Value, b: () => Value): Value {
    switch (op) {
        case '&':
            return truthy(a()) && truthy(b());
        case '|':
            return truthy(a()) || truthy(b());
        case '->':
            return !truthy(a()) || truthy(b());
        case '<->':
        case 'xnor':
            return truthy(a()) === truthy(b());
        case 'xor':
            return truthy(a()) !== truthy(b());
        case '=':
            return a() === b();
        case '!=':
            return a() !== b();
        case '<':
            return num(a()) < num(b());
        case '>':
            return num(a()) > num(b());
        case '<=':
            return num(a()) <= num(b());
        case '>=':
            return num(a()) >= num(b());
        case '+':
            return num(a()) + num(b());
        case '-':
            return num(a()) - num(b());
        case '*':
            return num(a()) * num(b());
        case '/':
            return Math.trunc(num(a()) / num(b()));
        case 'mod':
            return num(a()) % num(b());
    }
    throw new EvaluationError(`Temporal operator ${op} needs a trace.`);
}

/**
 * Incremental monitor of G(phi), phi over the present and the past: the same
 * construction as the generated Python monitors.
 */
export class PastTimeMonitor {
    private pre: boolean[] = [];
    private readonly inits: boolean[] = [];
    private readonly steps: Array<(v: Valuation, p: boolean[], n: boolean[]) => void> = [];
    private readonly verdict: (v: Valuation, p: boolean[], n: boolean[]) => boolean;
    violatedAt: number | null = null;
    private index = 0;

    constructor(body: Expression, names: Set<string>) {
        const compile = (e: Expression): ((v: Valuation, p: boolean[], n: boolean[]) => Value) => {
            if (isUnaryExpression(e) && ['Y', 'Z', 'O', 'H'].includes(e.operator)) {
                const inner = compile(e.operand);
                const k = this.inits.length;
                this.inits.push(e.operator === 'Z' || e.operator === 'H');
                if (e.operator === 'Y' || e.operator === 'Z') {
                    this.steps.push((v, p, n) => void (n[k] = truthy(inner(v, p, n))));
                    return (_v, p) => p[k];
                }
                this.steps.push(
                    e.operator === 'O' ? (v, p, n) => void (n[k] = truthy(inner(v, p, n)) || p[k]) : (v, p, n) => void (n[k] = truthy(inner(v, p, n)) && p[k])
                );
                return (_v, _p, n) => n[k];
            }
            if (isBinaryExpression(e) && (e.operator === 'S' || e.operator === 'T')) {
                const a = compile(e.left);
                const b = compile(e.right);
                const k = this.inits.length;
                this.inits.push(e.operator === 'T');
                this.steps.push(
                    e.operator === 'S'
                        ? (v, p, n) => void (n[k] = truthy(b(v, p, n)) || (truthy(a(v, p, n)) && p[k]))
                        : (v, p, n) => void (n[k] = truthy(b(v, p, n)) && (truthy(a(v, p, n)) || p[k]))
                );
                return (_v, _p, n) => n[k];
            }
            if (isUnaryExpression(e) && (e.operator === '!' || e.operator === '-')) {
                const inner = compile(e.operand);
                return e.operator === '!' ? (v, p, n) => !truthy(inner(v, p, n)) : (v, p, n) => -num(inner(v, p, n));
            }
            if (isUnaryExpression(e)) throw new EvaluationError(`future-time operator ${e.operator}`);
            if (isBinaryExpression(e)) {
                if (e.operator === 'U' || e.operator === 'V') throw new EvaluationError(`future-time operator ${e.operator}`);
                const a = compile(e.left);
                const b = compile(e.right);
                const op = e.operator;
                return (v, p, n) => applyBinary(op, () => a(v, p, n), () => b(v, p, n));
            }
            if (isPathQuantifiedExpression(e)) throw new EvaluationError('CTL path quantifier');
            return v => evaluate(e, v, names);
        };
        const top = compile(body);
        this.verdict = (v, p, n) => truthy(top(v, p, n));
        this.reset();
    }

    reset(): void {
        this.pre = [...this.inits];
        this.violatedAt = null;
        this.index = 0;
    }

    /** Feeds the valuation of the next step; returns whether the property still holds. */
    step(v: Valuation): boolean {
        const n = new Array<boolean>(this.inits.length).fill(false);
        for (const s of this.steps) s(v, this.pre, n);
        const ok = this.verdict(v, this.pre, n);
        this.pre = n;
        if (!ok && this.violatedAt === null) this.violatedAt = this.index;
        this.index++;
        return ok;
    }
}

/** The runtime-monitorable body of a property: INVARSPEC phi or LTLSPEC G phi (phi present/past). */
export function monitorBody(kind: string, e: Expression): Expression | null {
    if (kind === 'INVARSPEC') return e;
    if (kind === 'LTLSPEC' && isUnaryExpression(e) && e.operator === 'G') return e.operand;
    return null;
}

export function literal(text: string, kind: string): Value {
    if (kind === 'boolean') return text === 'TRUE';
    if (kind === 'range') return Number(text);
    return text;
}

function truthy(v: Value): boolean {
    return v === true;
}

function num(v: Value): number {
    if (typeof v !== 'number') throw new EvaluationError(`Expected a number, got ${String(v)}.`);
    return v;
}
