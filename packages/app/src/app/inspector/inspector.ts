import { Component, computed, inject, signal } from '@angular/core';
import { attributeDomain } from '@nuxmv-editor/language';
import { DiagramStore } from '../diagram-store';

/** Properties of the selected state or transition. */
@Component({
    selector: 'app-inspector',
    templateUrl: './inspector.html'
})
export class Inspector {
    readonly store = inject(DiagramStore);
    readonly renameError = signal<string | null>(null);

    readonly state = computed(() => {
        const sel = this.store.selection();
        return sel?.kind === 'state' ? (this.store.model().states.find(s => s.name === sel.name) ?? null) : null;
    });
    readonly transition = computed(() => {
        const sel = this.store.selection();
        return sel?.kind === 'transition' ? (this.store.model().transitions[sel.index] ?? null) : null;
    });
    readonly outgoing = computed(() => {
        const s = this.state();
        return s ? this.store.model().transitions.map((t, index) => ({ ...t, index })).filter(t => t.source === s.name) : [];
    });
    readonly incoming = computed(() => {
        const s = this.state();
        return s ? this.store.model().transitions.map((t, index) => ({ ...t, index })).filter(t => t.target === s.name && t.source !== s.name) : [];
    });
    readonly attributes = computed(() => this.store.model().attributes.map(a => ({ name: a.name, domain: attributeDomain(a.type) })));

    rename(from: string, input: HTMLInputElement): void {
        const error = this.store.renameState(from, input.value.trim());
        this.renameError.set(error);
        if (error) input.value = from;
    }

    setLabel(name: string, label: string): void {
        this.store.update(m => {
            const s = m.states.find(x => x.name === name);
            if (!s) return;
            if (label.trim()) s.label = label.trim();
            else delete s.label;
        });
    }

    setInitial(name: string, initial: boolean): void {
        this.store.update(m => {
            const s = m.states.find(x => x.name === name);
            if (s) s.initial = initial;
        });
    }

    setValue(name: string, attribute: string, value: string): void {
        this.store.update(m => {
            const s = m.states.find(x => x.name === name);
            if (!s) return;
            if (value) s.values[attribute] = value;
            else delete s.values[attribute];
        });
    }

    addSelfLoop(name: string): void {
        this.store.addTransition(name, name, false);
    }

    setTransitionLabel(index: number, label: string): void {
        this.store.update(m => {
            const t = m.transitions[index];
            if (!t) return;
            if (label.trim()) t.label = label.trim();
            else delete t.label;
        });
    }

    setGuard(index: number, text: string): void {
        this.store.update(m => {
            const t = m.transitions[index];
            if (!t) return;
            if (text.trim()) t.guard = text.trim();
            else delete t.guard;
        });
    }

    updatesText(index: number): string {
        return (this.store.model().transitions[index]?.updates ?? []).map(u => `${u.variable} := ${u.expression}`).join(', ');
    }

    setUpdates(index: number, text: string): void {
        const updates = text
            .split(',')
            .map(part => part.split(':='))
            .filter(p => p.length === 2 && p[0].trim() && p[1].trim())
            .map(([variable, expression]) => ({ variable: variable.trim(), expression: expression.trim() }));
        this.store.update(m => {
            const t = m.transitions[index];
            if (!t) return;
            if (updates.length > 0) t.updates = updates;
            else delete t.updates;
        });
    }

    setProbability(index: number, text: string): void {
        const p = Number(text);
        this.store.update(m => {
            const t = m.transitions[index];
            if (!t) return;
            if (text.trim() && Number.isFinite(p)) t.probability = p;
            else delete t.probability;
        });
    }

    reverse(index: number): void {
        this.store.update(m => {
            const t = m.transitions[index];
            if (t) [t.source, t.target] = [t.target, t.source];
        });
    }

    setDiagramName(name: string): void {
        const clean = name.trim().replace(/[^\w$#]/g, '_');
        this.store.update(m => {
            m.name = /^[_a-zA-Z]/.test(clean) ? clean : `d_${clean}`;
        });
    }

    select(index: number): void {
        this.store.selection.set({ kind: 'transition', index });
    }
}
