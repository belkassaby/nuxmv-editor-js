import { isBinaryExpression, isBooleanLiteral, isNameReference, isNumberLiteral, isPathQuantifiedExpression, isStateVariable, isUnaryExpression, type Expression } from './generated/ast.js';
import type { Diagram } from './generated/ast.js';
import { attributeDomain, type DiagramModel } from './model.js';
import { parseDiagram } from './parse.js';
import { PYTHON_RUNTIME } from './python-runtime.js';
import { serializeDiagram } from './serializer.js';

export interface PythonTransition {
    /** Index of the transition in the diagram model. */
    index: number;
    source: string;
    target: string;
    /** Python Event enum member, e.g. TESTS_PASSED. */
    event: string;
    label?: string;
}

export interface MonitorInfo {
    kind: string;
    name: string;
    expression: string;
    monitored: boolean;
    /** Why the property is only checked by nuXmv (future-time or CTL). */
    reason?: string;
}

export interface GeneratedPython {
    moduleName: string;
    className: string;
    code: string;
    transitions: PythonTransition[];
    monitors: MonitorInfo[];
    terminalStates: string[];
}

/**
 * Generates a Python module implementing the diagram as an event-driven state
 * machine: the transitions of the verified model are the only ones allowed,
 * and the properties that can be checked on the running system (invariants and
 * G(past-time formula)) become runtime monitors.
 */
export async function generatePython(model: DiagramModel, options: { sourceName?: string } = {}): Promise<GeneratedPython> {
    if (model.states.length === 0) throw new Error('The diagram has no states.');
    // Re-parse the canonical text to get the expression trees of the properties.
    const parsed = await parseDiagram(serializeDiagram(model));
    const ast: Diagram = parsed.ast;
    const specs = ast.elements.filter(e => e.$type === 'Specification');
    const astTransitions = ast.elements.filter(e => e.$type === 'Transition');
    const names = new Set([...model.attributes.map(a => a.name), ...model.variables.map(v => v.name)]);

    const name = model.name && model.name.length > 0 ? model.name : 'main';
    const className = pascal(name) + 'FSM';
    const moduleName = snake(name) + '_fsm';
    const stateMember = uniqueNames(model.states.map(s => upperSnake(s.name)));
    const stateOf = new Map(model.states.map((s, i) => [s.name, stateMember[i]]));

    // Unlabelled self-loops on states without any other exit are the stutter of
    // terminal states in the nuXmv model, not events of the running system.
    const exits = new Map<string, number>();
    for (const t of model.transitions) if (t.source !== t.target) exits.set(t.source, (exits.get(t.source) ?? 0) + 1);
    const terminal = model.states.filter(s => !exits.get(s.name)).map(s => s.name);
    const liveIndex = model.transitions.map((t, i) => i).filter(i => {
        const t = model.transitions[i];
        return !(t.source === t.target && !t.label && !t.guard && !t.updates?.length && terminal.includes(t.source));
    });
    const live = liveIndex.map(i => model.transitions[i]);

    const transitions = assignEvents(live).map((t, k) => ({ ...t, index: liveIndex[k] }));
    // Guards and updates of the live transitions, compiled to Python.
    const dataDefs: string[] = [];
    const guardEntries: string[] = [];
    const updateEntries: string[] = [];
    transitions.forEach((t, k) => {
        const node = astTransitions[liveIndex[k]];
        if (node?.$type !== 'Transition') return;
        const key = `(State.${stateOf.get(t.source)}, Event.${t.event})`;
        if (node.guard) {
            dataDefs.push(`def _guard_${k}(v):\n    return bool(${compilePresent(node.guard, names)})\n\n`);
            guardEntries.push(`    ${key}: _guard_${k},  # ${live[k].guard}`);
        }
        if (node.updates.length > 0) {
            const body = node.updates.map(u => `${py(u.variable.ref?.name ?? u.variable.$refText)}: ${compilePresent(u.value, names)}`).join(', ');
            dataDefs.push(`def _update_${k}(v):\n    return {${body}}\n\n`);
            updateEntries.push(`    ${key}: _update_${k},  # ${(live[k].updates ?? []).map(u => `${u.variable} := ${u.expression}`).join(', ')}`);
        }
    });
    const events = [...new Set(transitions.map(t => t.event))];
    const monitors: MonitorInfo[] = [];
    const monitorCode: string[] = [];
    const monitorDefs: string[] = [];
    model.specs.forEach((spec, i) => {
        const node = specs[i];
        const label = spec.name ?? `${spec.kind.toLowerCase()}_${i + 1}`;
        try {
            if (node?.$type !== 'Specification') throw new Unsupported('not parsed');
            const m = compileMonitor(node.kind, node.expression, names);
            const fn = `_check_${monitorDefs.length}`;
            monitorDefs.push(
                [
                    `def ${fn}(v, p, n):`,
                    `    """${spec.kind} ${label}: ${spec.expression.replace(/"/g, "'")}"""`,
                    ...m.statements.map(x => `    ${x}`),
                    `    return bool(${m.verdict})`,
                    '',
                    ''
                ].join('\n')
            );
            monitorCode.push(`    (${py(label)}, ${py(spec.kind)}, ${py(spec.expression)}, ${m.slots}, [${m.inits.map(b => (b ? 'True' : 'False')).join(', ')}], ${fn}),`);
            monitors.push({ kind: spec.kind, name: label, expression: spec.expression, monitored: true });
        } catch (error) {
            if (!(error instanceof Unsupported)) throw error;
            monitors.push({ kind: spec.kind, name: label, expression: spec.expression, monitored: false, reason: error.message });
        }
    });

    const initial = model.states.filter(s => s.initial).map(s => s.name);
    const initials = initial.length > 0 ? initial : [model.states[0].name];
    const lines: string[] = [];
    lines.push(`"""${name}: state machine generated by nuxmv-editor-js${options.sourceName ? ` from ${options.sourceName}` : ''}.`);
    lines.push('');
    lines.push('The transition table below is the one verified with nuXmv: send() rejects any other move.');
    lines.push('Properties checked by nuXmv on the diagram:');
    for (const m of monitors) {
        lines.push(`  - ${m.kind} ${m.name}: ${m.expression}${m.monitored ? '   [also monitored at run time]' : `   [static only: ${m.reason}]`}`);
    }
    lines.push('');
    lines.push('Usage:');
    lines.push(`    fsm = ${className}()`);
    lines.push('    fsm.allowed_events()          # legal next events (e.g. to constrain an LLM)');
    lines.push(`    fsm.send(${transitions[0] ? `"${transitions[0].event}"` : 'event'})`);
    lines.push('    fsm.widget()                  # live diagram in Jupyter (pip install anywidget)');
    lines.push('    fsm.link_editor(channel="me") # live state in nuxmv-editor');
    lines.push('"""');
    lines.push('');
    lines.push('from __future__ import annotations');
    lines.push('');
    lines.push('import enum');
    lines.push('');
    lines.push('');
    lines.push('class State(str, enum.Enum):');
    model.states.forEach((s, i) => lines.push(`    ${stateMember[i]} = ${py(s.name)}${s.label ? `  # ${s.label.replace(/\s+/g, ' ')}` : ''}`));
    lines.push('');
    lines.push('');
    lines.push('class Event(str, enum.Enum):');
    if (events.length === 0) lines.push('    pass');
    for (const e of events) lines.push(`    ${e} = ${py(e)}`);
    lines.push('');
    lines.push('');
    lines.push('#: Initial states of the model.');
    lines.push(`INITIAL_STATES = (${initials.map(s => `State.${stateOf.get(s)}`).join(', ')},)`);
    lines.push('#: States without outgoing transitions (they stutter in the nuXmv model).');
    lines.push(`TERMINAL_STATES = frozenset({${terminal.map(s => `State.${stateOf.get(s)}`).join(', ')}})`);
    lines.push('');
    lines.push('#: (state, event) -> next state: exactly the transitions of the verified diagram.');
    lines.push('TRANSITIONS = {');
    for (const t of transitions) {
        lines.push(`    (State.${stateOf.get(t.source)}, Event.${t.event}): State.${stateOf.get(t.target)},${t.label ? `  # ${t.label}` : ''}`);
    }
    lines.push('}');
    lines.push('');
    lines.push('#: Labelling L(s): attribute values in each state (None = any value, set it with send(..., values=)).');
    lines.push('LABELS = {');
    for (const s of model.states) {
        const values = model.attributes.map(a => `${py(a.name)}: ${s.values[a.name] !== undefined ? pyValue(s.values[a.name], a.type.kind) : 'None'}`);
        lines.push(`    State.${stateOf.get(s.name)}: {${values.join(', ')}},`);
    }
    lines.push('}');
    lines.push('');
    lines.push('#: Data variables and their initial values.');
    lines.push(`VARIABLES = {${model.variables.map(v => `${py(v.name)}: ${pyValue(v.initial, v.type.kind)}`).join(', ')}}`);
    lines.push('');
    lines.push('');
    lines.push(...dataDefs);
    lines.push('#: Guards: the transition is only allowed when its guard holds.');
    lines.push('GUARDS = {');
    lines.push(...guardEntries);
    lines.push('}');
    lines.push('#: Updates of the data variables performed by transitions.');
    lines.push('UPDATES = {');
    lines.push(...updateEntries);
    lines.push('}');
    lines.push('');
    lines.push('#: Domains of the attributes and variables.');
    lines.push('DOMAINS = {');
    for (const a of [...model.attributes, ...model.variables]) {
        const domain = a.type.kind === 'range' ? `range(${a.type.low}, ${a.type.high + 1})` : `(${attributeDomain(a.type).map(v => pyValue(v, a.type.kind)).join(', ')},)`;
        lines.push(`    ${py(a.name)}: ${domain},`);
    }
    lines.push('}');
    lines.push('');
    lines.push('# Runtime monitors, compiled from the properties. v: attribute values of the current state,');
    lines.push('# p: values of the past sub-formulas at the previous step, n: their values now.');
    lines.push('');
    lines.push('');
    lines.push(...monitorDefs);
    lines.push('#: (name, kind, formula, slots, initial past values, check function).');
    lines.push('MONITOR_SPECS = [');
    lines.push(...monitorCode);
    lines.push(']');
    lines.push('');
    lines.push('#: The diagram itself (for the Jupyter widget, SVG display and the editor link).');
    lines.push(`DIAGRAM = ${pyLiteral({
        name,
        states: model.states.map(s => ({ name: s.name, label: s.label ?? null, initial: s.initial, x: s.position?.x ?? null, y: s.position?.y ?? null })),
        transitions: live.map(t => ({
            source: t.source,
            target: t.target,
            label: [t.label, t.guard ? `[${t.guard}]` : '', t.updates?.length ? `/ ${t.updates.map(u => `${u.variable} := ${u.expression}`).join(', ')}` : '']
                .filter(Boolean)
                .join(' ') || null
        }))
    })}`);
    lines.push(PYTHON_RUNTIME);
    lines.push('');
    lines.push(`class ${className}(StateMachine):`);
    lines.push(`    """${name}. Subclass it and define on_enter_<state>(self, event, data) hooks to attach work to states."""`);
    lines.push('');
    lines.push('');
    lines.push('__all__ = [');
    lines.push(`    ${py(className)}, "State", "Event", "TRANSITIONS", "LABELS", "INITIAL_STATES", "TERMINAL_STATES",`);
    lines.push('    "InvalidTransition", "PropertyViolation", "EditorLink",');
    lines.push(']');
    lines.push('');

    return { moduleName, className, code: lines.join('\n'), transitions, monitors, terminalStates: terminal };
}

/** Events of the runtime, one per transition: from its label, or TO_<TARGET> when unlabelled. */
function assignEvents(transitions: DiagramModel['transitions']): Array<Omit<PythonTransition, 'index'>> {
    const result: Array<Omit<PythonTransition, 'index'>> = transitions.map(t => ({
        source: t.source,
        target: t.target,
        event: t.label ? upperSnake(t.label) : `TO_${upperSnake(t.target)}`,
        ...(t.label ? { label: t.label } : {})
    }));
    // Two transitions from the same state with the same event would make the
    // runtime ambiguous: disambiguate with the target.
    const seen = new Map<string, number>();
    for (const t of result) seen.set(`${t.source}|${t.event}`, (seen.get(`${t.source}|${t.event}`) ?? 0) + 1);
    for (const t of result) if ((seen.get(`${t.source}|${t.event}`) ?? 0) > 1) t.event = `${t.event}__TO_${upperSnake(t.target)}`;
    // Still equal (same source, event and target, e.g. different guards): number them.
    const count = new Map<string, number>();
    for (const t of result) {
        const k = `${t.source}|${t.event}`;
        const n = (count.get(k) ?? 0) + 1;
        count.set(k, n);
        if (n > 1) t.event = `${t.event}__${n}`;
    }
    return result;
}

/**
 * Event name of every transition of the model, as used by the generated code
 * and expected in recorded traces; undefined for the stutter self-loop of a
 * final state, which is not an event of the running system.
 */
export function transitionEvents(model: DiagramModel): Array<string | undefined> {
    const exits = new Map<string, number>();
    for (const t of model.transitions) if (t.source !== t.target) exits.set(t.source, (exits.get(t.source) ?? 0) + 1);
    const isStutter = (t: DiagramModel['transitions'][number]) => t.source === t.target && !t.label && !t.guard && !t.updates?.length && !exits.get(t.source);
    const liveIndex = model.transitions.map((_, i) => i).filter(i => !isStutter(model.transitions[i]));
    const events = assignEvents(liveIndex.map(i => model.transitions[i]));
    const result: Array<string | undefined> = model.transitions.map(() => undefined);
    liveIndex.forEach((i, k) => (result[i] = events[k].event));
    return result;
}

/** Normalises a label or event name the way the generated code does (TESTS_FAILED). */
export function eventName(text: string): string {
    return upperSnake(text);
}

// ---------------------------------------------------------------------------
// Monitor compilation: G(phi) with phi over the present and the past
// ---------------------------------------------------------------------------

class Unsupported extends Error {}

const FUTURE = new Set(['X', 'F', 'G', 'AG', 'AF', 'AX', 'EG', 'EF', 'EX']);

/**
 * Compiles a property into an incremental monitor (the classic dynamic
 * programming construction for past-time LTL): every past sub-formula gets a
 * slot whose value at the previous step is kept in p[] and at the current
 * step in n[].
 */
function compileMonitor(kind: string, expression: Expression, attributes: Set<string>): { statements: string[]; verdict: string; slots: number; inits: boolean[] } {
    let body: Expression;
    if (kind === 'INVARSPEC') body = expression;
    else if (kind === 'LTLSPEC' && isUnaryExpression(expression) && expression.operator === 'G') body = expression.operand;
    else if (kind === 'CTLSPEC') throw new Unsupported('CTL quantifies over all possible futures');
    else throw new Unsupported('not of the form G(present/past formula)');
    const c = compileExpression(body, attributes);
    return { statements: c.statements, verdict: c.value, slots: c.inits.length, inits: c.inits };
}

/** A guard or update: an expression over the current state only. */
function compilePresent(expression: Expression, names: Set<string>): string {
    const c = compileExpression(expression, names);
    if (c.inits.length > 0) throw new Error('Guards and updates cannot use past-time operators.');
    return c.value;
}

/** Python code for an expression; past operators add slot statements. */
function compileExpression(body: Expression, attributes: Set<string>): { statements: string[]; value: string; inits: boolean[] } {
    const inits: boolean[] = [];
    const parts: string[] = [];
    const slot = (init: boolean, make: (self: number) => string): number => {
        const i = inits.length;
        inits.push(init);
        parts.push(''); // reserve the position so children come first in evaluation order
        parts[i] = make(i);
        return i;
    };
    const compile = (e: Expression): string => {
        if (isBooleanLiteral(e)) return e.value === 'TRUE' ? 'True' : 'False';
        if (isNumberLiteral(e)) return String(e.value);
        if (isStateVariable(e)) return 'v["state"]';
        if (isNameReference(e)) return attributes.has(e.name) ? `v[${py(e.name)}]` : py(e.name);
        if (isPathQuantifiedExpression(e)) throw new Unsupported('CTL path quantifier');
        if (isUnaryExpression(e)) {
            const op = e.operator;
            if (op === '!') return `(not ${compile(e.operand)})`;
            if (op === '-') return `(-${compile(e.operand)})`;
            if (FUTURE.has(op)) throw new Unsupported(`future-time operator ${op}`);
            const inner = compile(e.operand);
            if (op === 'Y' || op === 'Z') {
                const k = slot(op === 'Z', i => `n[${i}] = ${inner}`);
                return `p[${k}]`;
            }
            if (op === 'O') return `n[${slot(false, i => `n[${i}] = (${inner}) or p[${i}]`)}]`;
            if (op === 'H') return `n[${slot(true, i => `n[${i}] = (${inner}) and p[${i}]`)}]`;
            throw new Unsupported(`operator ${op}`);
        }
        if (isBinaryExpression(e)) {
            const op = e.operator;
            if (op === 'U' || op === 'V') throw new Unsupported(`future-time operator ${op}`);
            const a = compile(e.left);
            const b = compile(e.right);
            switch (op) {
                case 'S':
                    return `n[${slot(false, i => `n[${i}] = (${b}) or ((${a}) and p[${i}])`)}]`;
                case 'T':
                    return `n[${slot(true, i => `n[${i}] = (${b}) and ((${a}) or p[${i}])`)}]`;
                case '&':
                    return `(${a} and ${b})`;
                case '|':
                    return `(${a} or ${b})`;
                case '->':
                    return `((not ${a}) or ${b})`;
                case '<->':
                case 'xnor':
                    return `(bool(${a}) == bool(${b}))`;
                case 'xor':
                    return `(bool(${a}) != bool(${b}))`;
                case '=':
                    return `(${a} == ${b})`;
                case '!=':
                    return `(${a} != ${b})`;
                case '<':
                case '>':
                case '<=':
                case '>=':
                case '+':
                case '-':
                case '*':
                    return `(${a} ${op} ${b})`;
                case '/':
                    return `int(${a} / ${b})`;
                case 'mod':
                    return `(${a} % ${b})`;
            }
        }
        throw new Unsupported('unsupported expression');
    };
    const value = compile(body);
    return { statements: parts, value, inits };
}

// ---------------------------------------------------------------------------
// Python literals and names
// ---------------------------------------------------------------------------

function py(text: string): string {
    return JSON.stringify(text);
}

function pyValue(value: string, kind: string): string {
    if (kind === 'boolean') return value === 'TRUE' ? 'True' : 'False';
    if (kind === 'range') return String(Number(value));
    return py(value);
}

function pyLiteral(value: unknown, indent = ''): string {
    if (value === null || value === undefined) return 'None';
    if (value === true) return 'True';
    if (value === false) return 'False';
    if (typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
    const inner = indent + '    ';
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        return '[\n' + value.map(v => inner + pyLiteral(v, inner)).join(',\n') + ',\n' + indent + ']';
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.every(([, v]) => v === null || typeof v !== 'object')) {
        return '{' + entries.map(([k, v]) => `${JSON.stringify(k)}: ${pyLiteral(v)}`).join(', ') + '}';
    }
    return '{\n' + entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${pyLiteral(v, inner)}`).join(',\n') + ',\n' + indent + '}';
}

const PYTHON_KEYWORDS = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']);

function words(text: string): string[] {
    return text
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean);
}

function upperSnake(text: string): string {
    const s = words(text).join('_').toUpperCase() || 'X';
    return /^[0-9]/.test(s) ? `_${s}` : s;
}

function snake(text: string): string {
    const s = words(text).join('_').toLowerCase() || 'diagram';
    const id = /^[0-9]/.test(s) ? `d_${s}` : s;
    return PYTHON_KEYWORDS.has(id) ? `${id}_` : id;
}

function pascal(text: string): string {
    const s = words(text).map(w => w[0].toUpperCase() + w.slice(1)).join('') || 'Diagram';
    return /^[0-9]/.test(s) ? `D${s}` : s;
}

function uniqueNames(names: string[]): string[] {
    const used = new Map<string, number>();
    return names.map(n => {
        const count = used.get(n) ?? 0;
        used.set(n, count + 1);
        return count === 0 ? n : `${n}_${count + 1}`;
    });
}
