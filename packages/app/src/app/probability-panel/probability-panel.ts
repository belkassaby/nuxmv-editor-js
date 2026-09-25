import { Component, computed, inject, signal } from '@angular/core';
import { analyse, exportPrism, type ProbabilisticQuery, type ProbabilisticResult } from '@nuxmv-editor/language';
import { DiagramStore } from '../diagram-store';
import { downloadText } from '../file-io';

type QueryRow = { kind: ProbabilisticQuery['kind']; target: string; bound: string; count: string };

/**
 * Probabilistic analysis of the diagram as a Markov chain (transition
 * probabilities from 'prob'), and export to PRISM / Storm.
 */
@Component({
    selector: 'app-probability-panel',
    templateUrl: './probability-panel.html'
})
export class ProbabilityPanel {
    readonly store = inject(DiagramStore);
    readonly rows = signal<QueryRow[]>([]);
    readonly results = signal<ProbabilisticResult[] | null>(null);
    readonly info = signal<string | null>(null);
    readonly error = signal<string | null>(null);
    readonly running = signal(false);
    readonly hasProbabilities = computed(() => this.store.model().transitions.some(t => t.probability !== undefined));

    constructor() {
        this.rows.set(this.suggest());
    }

    /** Default queries: reaching each final state, and the expected steps to the first one. */
    suggest(): QueryRow[] {
        const m = this.store.model();
        const exits = new Set(m.transitions.filter(t => t.source !== t.target).map(t => t.source));
        const finals = m.states.filter(s => !exits.has(s.name)).map(s => s.name);
        const rows: QueryRow[] = finals.slice(0, 3).map(f => ({ kind: 'reach', target: `state = ${f}`, bound: '', count: '' }));
        if (finals[0]) rows.push({ kind: 'steps', target: `state = ${finals[0]}`, bound: '', count: '' });
        return rows.length > 0 ? rows : [{ kind: 'reach', target: 'TRUE', bound: '', count: '' }];
    }

    add(): void {
        this.rows.update(r => [...r, { kind: 'reach', target: '', bound: '', count: '' }]);
    }

    remove(i: number): void {
        this.rows.update(r => r.filter((_, k) => k !== i));
    }

    set(i: number, patch: Partial<QueryRow>): void {
        this.rows.update(r => r.map((row, k) => (k === i ? { ...row, ...patch } : row)));
        this.results.set(null);
    }

    private queries(): ProbabilisticQuery[] {
        return this.rows()
            .filter(r => r.target.trim())
            .map(r =>
                r.kind === 'reach'
                    ? { kind: 'reach', target: r.target.trim(), ...(r.bound.trim() ? { bound: Math.max(0, Math.floor(Number(r.bound))) } : {}) }
                    : r.kind === 'steps'
                      ? { kind: 'steps', target: r.target.trim() }
                      : { kind: 'visits', target: r.target.trim(), count: r.count.trim() || 'TRUE' }
            );
    }

    async compute(): Promise<void> {
        this.running.set(true);
        this.error.set(null);
        try {
            const { dtmc, results } = await analyse(this.store.model(), this.queries());
            this.results.set(results);
            this.info.set(
                `${dtmc.configurations.length} configuration(s).` +
                    (dtmc.normalised ? ' Some states have transitions without a probability (they share what is left) or probabilities that do not add up to 1 (normalised).' : '')
            );
        } catch (e) {
            this.error.set((e as Error).message);
            this.results.set(null);
        } finally {
            this.running.set(false);
        }
    }

    async exportPrism(): Promise<void> {
        try {
            const out = await exportPrism(this.store.model(), this.queries());
            const base = this.store.fileName().replace(/\.nxd$/, '');
            downloadText(`${base}.pm`, out.model);
            downloadText(`${base}.pctl`, out.properties);
        } catch (e) {
            this.error.set((e as Error).message);
        }
    }

    fmt(v: number): string {
        return Number.isFinite(v) ? (Math.round(v * 1e6) / 1e6).toString() : '∞';
    }
}
