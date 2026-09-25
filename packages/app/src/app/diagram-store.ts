import { computed, effect, Injectable, signal } from '@angular/core';
import {
    EXAMPLES,
    GenerationError,
    deadEndStates,
    emptyDiagram,
    generateSmv,
    importLegacyAttributes,
    nextStateName,
    parseDiagram,
    serializeDiagram,
    successors,
    Semantics,
    type AttributeDef,
    type Configuration,
    type Diagnostic,
    type DiagramModel,
    type Position,
    type SpecResult,
    type Trace
} from '@nuxmv-editor/language';

export type Selection = { kind: 'state'; name: string } | { kind: 'transition'; index: number } | null;

/** Where the latest text change came from, so the editor does not echo its own edits. */
export type ChangeOrigin = 'editor' | 'diagram' | 'load';

export interface Highlight {
    /** Ordered list of states visited (trace steps or simulation path). */
    path: string[];
    /** Index of the current step in `path`. */
    current: number;
    /** Index in `path` where the lasso loop starts, if any. */
    loopStart?: number;
    /** Candidate successors (simulation). */
    candidates?: string[];
}

export interface Verification {
    running: boolean;
    engine?: string;
    command?: string;
    stdout?: string;
    stderr?: string;
    model?: string;
    errors: string[];
    warnings: string[];
    /** One entry per specification of the diagram, in declaration order. */
    results: Array<SpecResult | undefined>;
    durationMs?: number;
    exitCode?: number | null;
    timedOut?: boolean;
    requestError?: string;
    /** The diagram changed since this run: results may no longer apply. */
    stale?: boolean;
}

/**
 * Central state of the editor. The `.nxd` text (edited with the Langium
 * powered editor) and the diagram model (edited on the Cytoscape canvas) are
 * kept in sync: text edits are parsed into the model, diagram edits are
 * serialised back to text.
 */
@Injectable({ providedIn: 'root' })
export class DiagramStore {
    readonly text = signal('');
    readonly origin = signal<ChangeOrigin>('load');
    readonly model = signal<DiagramModel>(emptyDiagram());
    readonly diagnostics = signal<Diagnostic[]>([]);
    /** The text the current diagnostics refer to. */
    readonly diagnosedText = signal('');
    readonly hasSyntaxErrors = signal(false);
    readonly selection = signal<Selection>(null);
    readonly fileName = signal('diagram.nxd');
    readonly dirty = signal(false);
    readonly verification = signal<Verification | null>(null);
    readonly trace = signal<{ specIndex: number; trace: Trace } | null>(null);
    readonly traceStep = signal(0);
    /** Simulated run: configurations (state + data variables), oldest first. */
    readonly simulation = signal<Configuration[] | null>(null);
    /** Executable semantics of the current model (guards, updates), rebuilt when it changes. */
    readonly semantics = signal<Semantics | null>(null);
    /** States reported by a running Python machine (live link), oldest first. */
    readonly live = signal<string[] | null>(null);
    /** Incremented to ask the canvas to run an automatic layout. */
    readonly layoutRequests = signal(0);
    /** Incremented when a new document is loaded, so the canvas fits it in view. */
    readonly loads = signal(0);

    readonly errorCount = computed(() => this.diagnostics().filter(d => d.severity === 'error').length);
    readonly warningCount = computed(() => this.diagnostics().filter(d => d.severity === 'warning').length);
    readonly deadEnds = computed(() => new Set(deadEndStates(this.model())));

    readonly generated = computed(() => {
        try {
            return { ...generateSmv(this.model()), error: undefined as string | undefined };
        } catch (error) {
            if (error instanceof GenerationError) return { text: '', notes: [], error: error.message };
            throw error;
        }
    });

    readonly highlight = computed<Highlight | null>(() => {
        const live = this.live();
        if (live) {
            const current = live[live.length - 1];
            return { path: live, current: live.length - 1, candidates: current ? successors(this.model(), current) : [] };
        }
        const sim = this.simulation();
        if (sim) {
            const last = sim[sim.length - 1];
            const sem = this.semantics();
            // Same semantics as the generated model: guards, updates, and stutter when nothing is enabled.
            const next = !last
                ? this.initialStates()
                : sem
                  ? [...new Set(sem.successors(last).map(s => s.config.state))]
                  : successors(this.model(), last.state);
            return { path: sim.map(c => c.state), current: sim.length - 1, candidates: next };
        }
        const t = this.trace();
        if (!t) return null;
        return {
            path: t.trace.steps.map(s => s.values['state'] ?? ''),
            current: this.traceStep(),
            loopStart: t.trace.loopStart
        };
    });

    /** Message shown when an edit could not be applied. */
    readonly notice = signal<string | null>(null);

    private parseTimer: ReturnType<typeof setTimeout> | undefined;
    private pendingText: string | null = null;
    private flushing: Promise<void> | null = null;
    private parseGeneration = 0;

    constructor() {
        this.loadExample(EXAMPLES[0].id);
        let timer: ReturnType<typeof setTimeout> | undefined;
        effect(() => {
            const model = this.model();
            clearTimeout(timer);
            timer = setTimeout(() => {
                Semantics.of(model).then(
                    sem => this.model() === model && this.semantics.set(sem),
                    () => this.semantics.set(null)
                );
            }, 150);
        });
    }

    // ------------------------------------------------------------------ text

    /** Called by the text editor on every keystroke. */
    setText(text: string, origin: ChangeOrigin = 'editor'): void {
        if (text === this.text()) return;
        this.text.set(text);
        this.origin.set(origin);
        this.dirty.set(true);
        this.pendingText = text;
        clearTimeout(this.parseTimer);
        this.parseTimer = setTimeout(() => void this.flushParse(), origin === 'editor' ? 250 : 0);
    }

    /** Parses the latest typed text now, if it has not been parsed yet. */
    private flushParse(): Promise<void> {
        clearTimeout(this.parseTimer);
        const text = this.pendingText;
        if (text === null) return this.flushing ?? Promise.resolve();
        this.pendingText = null;
        const flushing = this.parse(text, true).finally(() => {
            if (this.flushing === flushing) this.flushing = null;
        });
        this.flushing = flushing;
        return flushing;
    }

    private async parse(text: string, updateModel: boolean): Promise<void> {
        const generation = ++this.parseGeneration;
        const outcome = await parseDiagram(text);
        if (generation !== this.parseGeneration) return;
        this.diagnostics.set(outcome.diagnostics);
        this.diagnosedText.set(text);
        this.hasSyntaxErrors.set(outcome.hasSyntaxErrors);
        if (!outcome.hasSyntaxErrors) this.notice.set(null);
        // Keep the last good drawing while the user is in the middle of typing.
        if (updateModel && !outcome.hasSyntaxErrors) {
            this.model.set(outcome.model);
            this.pruneSelection();
            this.invalidateResults();
        }
    }

    // ----------------------------------------------------------------- model

    /**
     * Applies a structural edit coming from the diagram or the side panels.
     * Text typed but not parsed yet is parsed first so that it is not lost;
     * edits are refused while the text has syntax errors, since serialising
     * the last good model would overwrite what the user is typing.
     */
    update(mutate: (model: DiagramModel) => void): void {
        if (this.pendingText !== null || this.flushing) {
            // Queued edits run in order once the typed text has been parsed.
            void this.flushParse().then(() => this.update(mutate));
            return;
        }
        if (this.hasSyntaxErrors()) {
            this.notice.set('Fix the syntax errors in the text first: the diagram cannot be edited while the text does not parse.');
            return;
        }
        this.notice.set(null);
        const next = structuredClone(this.model());
        mutate(next);
        this.model.set(next);
        const text = serializeDiagram(next);
        this.text.set(text);
        this.origin.set('diagram');
        this.dirty.set(true);
        this.pruneSelection();
        this.invalidateResults();
        void this.parse(text, false);
    }

    addState(position?: Position): void {
        this.update(m => {
            const name = nextStateName(m);
            m.states.push({ name, initial: m.states.length === 0, values: {}, ...(position ? { position: round(position) } : {}) });
            this.selection.set({ kind: 'state', name });
        });
    }

    addTransition(source: string, target: string, select = true): void {
        this.update(m => {
            m.transitions.push({ source, target });
            if (select) this.selection.set({ kind: 'transition', index: m.transitions.length - 1 });
        });
    }

    moveStates(positions: Record<string, Position>): void {
        const changed = this.model().states.some(s => {
            const p = positions[s.name];
            return p && (!s.position || Math.round(p.x) !== s.position.x || Math.round(p.y) !== s.position.y);
        });
        if (!changed) return;
        this.update(m => {
            for (const s of m.states) if (positions[s.name]) s.position = round(positions[s.name]);
        });
    }

    renameState(from: string, to: string): string | null {
        if (from === to) return null;
        if (!/^[_a-zA-Z][\w$#]*$/.test(to)) return 'Names start with a letter or _ and contain letters, digits, _, $ or #.';
        if (this.model().states.some(s => s.name === to)) return `A state named '${to}' already exists.`;
        if (this.model().attributes.some(a => a.name === to)) return `'${to}' is an attribute name.`;
        const word = new RegExp(`(?<![\\w$#])${escapeRegExp(from)}(?![\\w$#])`, 'g');
        if (this.hasSyntaxErrors()) return 'Fix the syntax errors in the text first.';
        this.update(m => {
            for (const s of m.states) if (s.name === from) s.name = to;
            for (const t of m.transitions) {
                if (t.source === from) t.source = to;
                if (t.target === from) t.target = to;
            }
            for (const s of m.specs) s.expression = s.expression.replace(word, to);
            for (const f of m.fairness) f.expression = f.expression.replace(word, to);
            this.selection.set({ kind: 'state', name: to });
        });
        return null;
    }

    deleteSelection(): void {
        const sel = this.selection();
        if (!sel) return;
        if (sel.kind === 'state') {
            this.update(m => {
                m.states = m.states.filter(s => s.name !== sel.name);
                m.transitions = m.transitions.filter(t => t.source !== sel.name && t.target !== sel.name);
            });
        } else {
            this.update(m => m.transitions.splice(sel.index, 1));
        }
        this.selection.set(null);
    }

    setAttributes(attributes: AttributeDef[]): void {
        this.update(m => {
            const renamed = new Map<string, string>();
            m.attributes.forEach((a, i) => attributes[i] && renamed.set(a.name, attributes[i].name));
            m.attributes = attributes;
            const names = new Set(attributes.map(a => a.name));
            for (const s of m.states) {
                const values: Record<string, string> = {};
                for (const [k, v] of Object.entries(s.values)) {
                    const name = renamed.get(k) ?? k;
                    if (names.has(name)) values[name] = v;
                }
                s.values = values;
            }
        });
    }

    requestLayout(): void {
        this.layoutRequests.update(n => n + 1);
    }

    // ------------------------------------------------------------- documents

    newDiagram(): void {
        this.load(serializeDiagram(emptyDiagram('untitled')), 'untitled.nxd');
    }

    loadExample(id: string): void {
        const example = EXAMPLES.find(e => e.id === id) ?? EXAMPLES[0];
        this.load(example.source, `${example.id}.nxd`);
    }

    load(text: string, fileName: string): void {
        this.fileName.set(fileName);
        this.selection.set(null);
        this.stopHighlight();
        this.verification.set(null);
        this.setText(text, 'load');
        this.dirty.set(false);
        this.loads.update(n => n + 1);
    }

    importLegacy(text: string): void {
        const next = importLegacyAttributes(text, this.model());
        this.update(m => {
            m.attributes = next.attributes;
            m.states = next.states;
        });
    }

    // ---------------------------------------------------------- verification

    setVerification(v: Verification | null): void {
        this.verification.set(v);
        this.trace.set(null);
    }

    showTrace(specIndex: number): void {
        const result = this.verification()?.results[specIndex];
        if (!result?.trace) return;
        this.simulation.set(null);
        this.live.set(null);
        this.trace.set({ specIndex, trace: result.trace });
        this.traceStep.set(0);
    }

    stepTrace(delta: number): void {
        const t = this.trace();
        if (!t) return;
        const n = t.trace.steps.length;
        this.traceStep.set(Math.max(0, Math.min(n - 1, this.traceStep() + delta)));
    }

    stopHighlight(): void {
        this.trace.set(null);
        this.simulation.set(null);
        this.live.set(null);
    }

    // ------------------------------------------------------------- live link

    startLive(): void {
        this.trace.set(null);
        this.simulation.set(null);
        this.live.set([]);
    }

    pushLive(state: string, restarted = false): void {
        const path = restarted ? [] : (this.live() ?? []);
        this.live.set([...path, state].slice(-200));
    }

    // ------------------------------------------------------------ simulation

    initialStates(): string[] {
        const states = this.model().states;
        const initial = states.filter(s => s.initial).map(s => s.name);
        return initial.length > 0 ? initial : states.slice(0, 1).map(s => s.name);
    }

    startSimulation(): void {
        this.trace.set(null);
        this.live.set(null);
        const initial = this.initialConfigurations();
        this.simulation.set(initial.length === 1 ? [initial[0]] : []);
    }

    simulateTo(state: string): void {
        const path = this.simulation();
        if (!path) return;
        const last = path[path.length - 1];
        if (!last) {
            const start = this.initialConfigurations().find(c => c.state === state);
            if (start) this.simulation.set([start]);
            return;
        }
        const sem = this.semantics();
        const step = sem ? sem.successors(last).find(s => s.config.state === state)?.config : successors(this.model(), last.state).includes(state) ? { state, variables: { ...last.variables } } : undefined;
        if (step) this.simulation.set([...path, step]);
    }

    private initialConfigurations(): Configuration[] {
        const sem = this.semantics();
        return sem ? sem.initialConfigurations() : this.initialStates().map(state => ({ state, variables: {} }));
    }

    simulateRandom(): void {
        const candidates = this.highlight()?.candidates ?? [];
        if (candidates.length === 0) return;
        this.simulateTo(candidates[Math.floor(Math.random() * candidates.length)]);
    }

    simulateBack(): void {
        const path = this.simulation();
        if (path && path.length > 0) this.simulation.set(path.slice(0, -1));
    }

    // -------------------------------------------------------------- helpers

    private pruneSelection(): void {
        const sel = this.selection();
        const m = this.model();
        if (sel?.kind === 'state' && !m.states.some(s => s.name === sel.name)) this.selection.set(null);
        if (sel?.kind === 'transition' && sel.index >= m.transitions.length) this.selection.set(null);
    }

    /** Results and traces refer to the model they were computed for. */
    private invalidateResults(): void {
        const v = this.verification();
        if (v && !v.running && !v.stale && v.model !== this.generated().text) {
            this.verification.set({ ...v, stale: true });
            this.trace.set(null);
        }
        const sim = this.simulation();
        if (sim && sim.some(c => !this.model().states.some(x => x.name === c.state))) this.simulation.set(null);
    }
}

function round(p: Position): Position {
    return { x: Math.round(p.x), y: Math.round(p.y) };
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
