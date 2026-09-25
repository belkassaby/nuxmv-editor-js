import type { DiagramModel } from './model.js';
import { parseDiagram } from './parse.js';
import { eventName, transitionEvents } from './python-generator.js';
import { serializeDiagram } from './serializer.js';
import { monitorBody, PastTimeMonitor, Semantics, type Configuration, type Valuation, type Value } from './semantics.js';

/** One step of a recorded run: the state reached, and optionally the event and values. */
export interface TraceRecord {
    state: string;
    event?: string | null;
    /** Attribute and variable values observed in that state, if recorded. */
    values?: Record<string, unknown>;
    time?: string | number;
}

export type IssueKind = 'unknown-state' | 'not-initial' | 'no-transition' | 'guard-false' | 'wrong-event' | 'value-mismatch' | 'property';

export interface ConformanceIssue {
    /** Index of the record where the problem was detected. */
    step: number;
    kind: IssueKind;
    message: string;
}

export interface ConformanceStep {
    record: TraceRecord;
    /** Index of the model transition taken to reach this step (null for the first step or a stutter). */
    transition: number | null;
    /** Full valuation used for the monitors (state, attributes, variables). */
    values: Valuation;
    ok: boolean;
}

export interface ConformanceReport {
    steps: ConformanceStep[];
    issues: ConformanceIssue[];
    conforms: boolean;
    /** Properties checked on the run (the runtime-monitorable ones). */
    monitored: string[];
}

/**
 * Checks a recorded run against the verified model: every step must follow a
 * transition that exists and is enabled (guard true, updates in range), with
 * the recorded event if one is given, and the monitorable properties must hold
 * on the run. After a deviation the checker resynchronises on the recorded
 * state so that later problems are reported too.
 */
export async function checkConformance(model: DiagramModel, records: TraceRecord[]): Promise<ConformanceReport> {
    const sem = await Semantics.of(model);
    const events = transitionEvents(model);
    const names = new Set([...model.attributes.map(a => a.name), ...model.variables.map(v => v.name)]);
    const monitors = await buildMonitors(model, names);
    const issues: ConformanceIssue[] = [];
    const steps: ConformanceStep[] = [];
    const known = new Set(model.states.map(s => s.name));
    let config: Configuration | undefined;

    records.forEach((record, i) => {
        let transition: number | null = null;
        let ok = true;
        const problem = (kind: IssueKind, message: string) => {
            ok = false;
            issues.push({ step: i, kind, message });
        };
        if (!known.has(record.state)) {
            problem('unknown-state', `'${record.state}' is not a state of the diagram.`);
        } else if (!config) {
            const initial = sem.initialConfigurations();
            config = initial.find(c => c.state === record.state);
            if (!config) {
                problem('not-initial', `The run starts in '${record.state}', which is not an initial state (${initial.map(c => c.state).join(', ')}).`);
                config = { state: record.state, variables: initial[0]?.variables ?? {} };
            }
        } else {
            const from: Configuration = config;
            const recorded = record.event ? eventName(record.event) : undefined;
            const candidates = model.transitions.map((t, k) => k).filter(k => model.transitions[k].source === from.state && model.transitions[k].target === record.state);
            const enabled = candidates.filter(k => sem.isEnabled(k, from));
            const matching = recorded ? enabled.filter(k => events[k] === recorded) : enabled;
            if (candidates.length === 0) {
                if (from.state === record.state && sem.enabled(from).length === 0) transition = null; // stutter of a final state
                else problem('no-transition', `No transition ${from.state} -> ${record.state} in the model${recorded ? ` (event ${recorded})` : ''}.`);
            } else if (enabled.length === 0) {
                problem('guard-false', `${from.state} -> ${record.state} is not enabled here: ${describeBlocked(model, candidates, from)}.`);
            } else if (matching.length === 0) {
                problem('wrong-event', `Event ${recorded} does not lead from ${from.state} to ${record.state}; the model expects ${enabled.map(k => events[k] ?? '(stutter)').join(' or ')}.`);
            }
            const taken = matching[0] ?? enabled[0];
            if (taken !== undefined) {
                transition = taken;
                config = sem.fire(taken, from);
            } else {
                // Resynchronise on the recorded state, keeping the variables.
                config = { state: record.state, variables: { ...from.variables } };
            }
        }

        // Recorded variable values override the simulated ones (and must agree with them).
        if (config && record.values) {
            for (const v of model.variables) {
                if (!(v.name in record.values)) continue;
                const observed = normalise(record.values[v.name]);
                if (ok && config.variables[v.name] !== observed) {
                    problem('value-mismatch', `${v.name} = ${String(observed)} recorded, the model gives ${String(config.variables[v.name])}.`);
                }
                config.variables[v.name] = observed;
            }
        }
        const values: Valuation = config ? sem.valuation(config) : { state: record.state };
        if (record.values) {
            for (const a of model.attributes) if (a.name in record.values) values[a.name] = normalise(record.values[a.name]);
        }
        for (const m of monitors) {
            if (!m.monitor.step(values) && m.monitor.violatedAt === steps.length) {
                problem('property', `${m.kind} ${m.name} is violated: ${m.expression}`);
            }
        }
        steps.push({ record, transition, values, ok });
    });

    return { steps, issues, conforms: issues.length === 0, monitored: monitors.map(m => m.name) };
}

async function buildMonitors(model: DiagramModel, names: Set<string>) {
    const parsed = await parseDiagram(serializeDiagram(model));
    const specs = parsed.ast.elements.filter(e => e.$type === 'Specification');
    const monitors: Array<{ name: string; kind: string; expression: string; monitor: PastTimeMonitor }> = [];
    model.specs.forEach((spec, i) => {
        const node = specs[i];
        if (node?.$type !== 'Specification') return;
        const body = monitorBody(node.kind, node.expression);
        if (!body) return;
        try {
            monitors.push({ name: spec.name ?? `${spec.kind.toLowerCase()}_${i + 1}`, kind: spec.kind, expression: spec.expression, monitor: new PastTimeMonitor(body, names) });
        } catch {
            // Future-time operators inside G: not monitorable, checked by nuXmv only.
        }
    });
    return monitors;
}

function describeBlocked(model: DiagramModel, candidates: number[], from: Configuration): string {
    return candidates
        .map(k => {
            const t = model.transitions[k];
            return t.guard ? `guard ${t.guard} is false (${Object.entries(from.variables).map(([n, v]) => `${n}=${String(v)}`).join(', ') || 'no variables'})` : 'an update would leave its range';
        })
        .join('; ');
}

function normalise(value: unknown): Value {
    if (value === 'TRUE' || value === 'True' || value === 'true') return true;
    if (value === 'FALSE' || value === 'False' || value === 'false') return false;
    if (typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
    return value === null || value === undefined ? undefined : String(value);
}

/**
 * Reads a recorded run. Accepted formats:
 *  - JSON Lines, one object per step with a `state` (or `target`) field
 *    (the generated runtime's record_to(), EditorLink payloads, custom logs);
 *  - a JSON array of such objects;
 *  - OpenTelemetry JSON (OTLP export or a list of spans) whose spans carry
 *    `fsm.state` / `fsm.event` attributes, as emitted by the generated runtime.
 */
export function parseTrace(text: string): TraceRecord[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    let items: unknown[];
    if (trimmed.startsWith('[') || (trimmed.startsWith('{') && !trimmed.includes('\n{'))) {
        const parsed = JSON.parse(trimmed) as unknown;
        const spans = otelSpans(parsed);
        if (spans) return spans;
        items = Array.isArray(parsed) ? parsed : [parsed];
    } else {
        items = trimmed
            .split(/\r?\n/)
            .filter(l => l.trim())
            .map((l, i) => {
                try {
                    return JSON.parse(l) as unknown;
                } catch {
                    throw new Error(`Line ${i + 1} is not valid JSON.`);
                }
            });
    }
    return items.map((item, i) => {
        const o = item as Record<string, unknown>;
        const state = (o['state'] ?? o['target']) as unknown;
        if (typeof state !== 'string') throw new Error(`Record ${i + 1} has no 'state' (or 'target') field.`);
        const record: TraceRecord = { state };
        if (typeof o['event'] === 'string') record.event = o['event'];
        if (o['values'] && typeof o['values'] === 'object') record.values = o['values'] as Record<string, unknown>;
        if (typeof o['time'] === 'string' || typeof o['time'] === 'number') record.time = o['time'];
        return record;
    });
}

/** Extracts FSM steps from OpenTelemetry spans (OTLP JSON or a plain list of spans). */
function otelSpans(parsed: unknown): TraceRecord[] | null {
    const spans: Array<Record<string, unknown>> = [];
    const collect = (x: unknown) => {
        if (!x || typeof x !== 'object') return;
        const o = x as Record<string, unknown>;
        if (Array.isArray(o['resourceSpans'])) {
            for (const rs of o['resourceSpans'] as Array<Record<string, unknown>>) {
                for (const ss of (rs['scopeSpans'] ?? rs['instrumentationLibrarySpans'] ?? []) as Array<Record<string, unknown>>) {
                    for (const span of (ss['spans'] ?? []) as Array<Record<string, unknown>>) spans.push(span);
                }
            }
        } else if ('attributes' in o && ('name' in o || 'context' in o)) {
            spans.push(o);
        }
    };
    if (Array.isArray(parsed)) parsed.forEach(collect);
    else collect(parsed);
    const steps = spans
        .map(span => ({ span, attrs: attributesOf(span['attributes']) }))
        .filter(({ attrs }) => typeof attrs['fsm.state'] === 'string' && attrs['fsm.rejected'] !== true);
    if (steps.length === 0) return null;
    steps.sort((a, b) => Number(a.attrs['fsm.step'] ?? 0) - Number(b.attrs['fsm.step'] ?? 0) || String(startOf(a.span)).localeCompare(String(startOf(b.span))));
    return steps.map(({ attrs, span }) => {
        const values: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(attrs)) if (k.startsWith('fsm.value.')) values[k.slice('fsm.value.'.length)] = v;
        const record: TraceRecord = { state: String(attrs['fsm.state']) };
        if (typeof attrs['fsm.event'] === 'string' && attrs['fsm.event']) record.event = attrs['fsm.event'];
        if (Object.keys(values).length > 0) record.values = values;
        const start = startOf(span);
        if (start !== undefined) record.time = start;
        return record;
    });
}

function startOf(span: Record<string, unknown>): string | number | undefined {
    const t = span['startTimeUnixNano'] ?? span['start_time'];
    return typeof t === 'string' || typeof t === 'number' ? t : undefined;
}

/** OTLP attributes are [{key, value: {stringValue|intValue|boolValue|doubleValue}}]; SDK dumps use plain objects. */
function attributesOf(raw: unknown): Record<string, unknown> {
    if (!raw) return {};
    if (!Array.isArray(raw)) return raw as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const a of raw as Array<{ key: string; value: Record<string, unknown> }>) {
        const v = a.value ?? {};
        out[a.key] = v['stringValue'] ?? (v['intValue'] !== undefined ? Number(v['intValue']) : undefined) ?? v['boolValue'] ?? v['doubleValue'];
    }
    return out;
}
