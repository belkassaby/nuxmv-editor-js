/**
 * Parser for the textual output of nuXmv: specification verdicts and
 * counterexample traces (the "NusmvToJung" direction suggested as future work
 * in the original dissertation).
 */

export type Verdict = 'true' | 'false' | 'unknown';

export interface TraceStep {
    /** nuXmv state id, e.g. `1.3`. */
    id: string;
    /** Complete valuation of the variables in this step (nuXmv only prints changes). */
    values: Record<string, string>;
    /** Variables whose value changed at this step. */
    changed: string[];
    /** Input variables (IVAR) leading into this step, if any. */
    inputs?: Record<string, string>;
}

export interface Trace {
    description: string;
    type: string;
    steps: TraceStep[];
    /** Index into `steps` at which the lasso loop starts, if the trace is a lasso. */
    loopStart?: number;
}

export interface SpecResult {
    /** `specification`, `invariant`, `LTL specification`, ... as printed by nuXmv. */
    category: string;
    /** The property as echoed by nuXmv. */
    property: string;
    verdict: Verdict;
    /** Extra information, e.g. the BMC bound that was reached. */
    detail?: string;
    trace?: Trace;
}

export interface NuxmvOutput {
    results: SpecResult[];
    errors: string[];
    warnings: string[];
}

const VERDICT = /^--\s+((?:LTL |CTL |PSL )?specification|invariant)\s+(.*?)\s+is\s+(true|false)\s*$/;
const NO_CEX = /^--\s+no (?:proof or )?counterexample found with bound\s+(\d+)/;
const STEP = /^->\s+State:\s+(\S+)\s+<-$/;
const INPUT = /^->\s+Input:\s+(\S+)\s+<-$/;
const ASSIGNMENT = /^([^=\s][^=]*?)\s+=\s+(.*)$/;

export function parseNuxmvOutput(stdout: string, stderr = ''): NuxmvOutput {
    const results: SpecResult[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    const lines = stdout.split(/\r?\n/);
    let current: SpecResult | undefined;
    let trace: Trace | undefined;
    let pendingInputs: Record<string, string> | undefined;
    let readingInputs = false;
    let loopNext = false;
    let lastBound: number | undefined;

    const pushUnknown = () => {
        closeTrace();
        current = { category: 'specification', property: '', verdict: 'unknown', detail: `no proof or counterexample up to bound ${lastBound}` };
        results.push(current);
        lastBound = undefined;
    };
    const closeTrace = () => {
        if (trace && current && !current.trace) current.trace = trace;
        trace = undefined;
        pendingInputs = undefined;
        readingInputs = false;
        loopNext = false;
    };

    for (const raw of lines) {
        const line = raw.trim();
        if (line.length === 0 || line.startsWith('***')) continue;

        let m = VERDICT.exec(line);
        if (m) {
            closeTrace();
            current = { category: m[1], property: m[2].replace(/\s+/g, ' ').trim(), verdict: m[3] as Verdict };
            results.push(current);
            lastBound = undefined;
            continue;
        }
        m = NO_CEX.exec(line);
        if (m) {
            const bound = Number(m[1]);
            // A bound that does not increase starts the search for the next property:
            // the previous one ended without a verdict.
            if (lastBound !== undefined && bound <= lastBound) pushUnknown();
            lastBound = bound;
            continue;
        }
        if (line.startsWith('Trace Description:')) {
            trace = { description: line.slice('Trace Description:'.length).trim(), type: '', steps: [] };
            continue;
        }
        if (trace && line.startsWith('Trace Type:')) {
            trace.type = line.slice('Trace Type:'.length).trim();
            continue;
        }
        if (trace && /^--\s+Loop starts here/i.test(line)) {
            loopNext = true;
            continue;
        }
        if (trace && (m = STEP.exec(line))) {
            const previous = trace.steps[trace.steps.length - 1];
            const step: TraceStep = { id: m[1], values: { ...(previous?.values ?? {}) }, changed: [] };
            if (pendingInputs) step.inputs = pendingInputs;
            pendingInputs = undefined;
            readingInputs = false;
            if (loopNext) {
                trace.loopStart = trace.steps.length;
                loopNext = false;
            }
            trace.steps.push(step);
            continue;
        }
        if (trace && INPUT.exec(line)) {
            pendingInputs = {};
            readingInputs = true;
            continue;
        }
        if (trace && (m = ASSIGNMENT.exec(line)) && !line.startsWith('--')) {
            if (readingInputs && pendingInputs) {
                pendingInputs[m[1]] = m[2];
            } else {
                const step = trace.steps[trace.steps.length - 1];
                if (step) {
                    step.values[m[1]] = m[2];
                    step.changed.push(m[1]);
                }
            }
            continue;
        }
        if (/^(nuXmv|NuSMV)\s*>/.test(line)) continue;
        if (/error/i.test(line) || /^file .*: line \d+:/.test(line)) errors.push(line);
        else if (/^warning/i.test(line)) warnings.push(line);
    }
    closeTrace();

    for (const raw of stderr.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('***')) continue;
        if (/warning/i.test(line)) warnings.push(line);
        else errors.push(line);
    }
    if (lastBound !== undefined) pushUnknown();
    return { results, errors, warnings };
}

/** Normalises an expression so that user text and nuXmv's echo can be compared. */
export function normaliseProperty(expression: string): string {
    return expression.replace(/[\s()]/g, '');
}

export interface SpecLike {
    kind: string;
    name?: string;
    expression: string;
}

/**
 * Associates parsed results with the specifications of the diagram. nuXmv does
 * not report properties in declaration order (CTL before invariants before
 * LTL, and some engines skip kinds), so results are matched on the normalised
 * property text first; results without text (bounded runs that ended without
 * verdict) are given to the remaining LTL/invariant specifications in order.
 */
export function matchResults(specs: SpecLike[], results: SpecResult[]): Array<SpecResult | undefined> {
    const matched: Array<SpecResult | undefined> = specs.map(() => undefined);
    const normalised = specs.map(s => normaliseProperty(s.expression));
    const leftovers: SpecResult[] = [];
    for (const result of results) {
        const key = normaliseProperty(result.property);
        const index = key ? normalised.findIndex((n, i) => n === key && matched[i] === undefined && kindMatches(specs[i].kind, result.category)) : -1;
        if (index >= 0) matched[index] = result;
        else leftovers.push(result);
    }
    for (const result of leftovers) {
        const index = specs.findIndex((s, i) => matched[i] === undefined && s.kind !== 'CTLSPEC');
        if (index >= 0) matched[index] = result;
    }
    return matched;
}

function kindMatches(kind: string, category: string): boolean {
    if (category === 'invariant') return kind === 'INVARSPEC';
    if (category.startsWith('LTL')) return kind === 'LTLSPEC';
    if (category.startsWith('CTL')) return kind === 'CTLSPEC';
    return kind !== 'INVARSPEC';
}
