import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { EXAMPLES, emptyDiagram, serializeDiagram } from '@provenflow/language';
import { DiagramStore, type Verification } from '../diagram-store';

/** Where a document comes from, for its icon and tooltip. */
export type DocumentKind = 'file' | 'example' | 'new' | 'code' | 'import';

/** An open document. The active one lives in the DiagramStore; the others keep a snapshot. */
export interface DocumentTab {
    id: number;
    fileName: string;
    kind: DocumentKind;
    text: string;
    dirty: boolean;
    /** Kept while the tab is in the background (not saved across reloads). */
    verification: Verification | null;
    trace: ReturnType<DiagramStore['trace']>;
    traceStep: number;
}

const STORAGE_KEY = 'provenflow.tabs';

/** Saved across reloads: which documents were open and their text. */
interface SavedTabs {
    active: number;
    tabs: Array<Pick<DocumentTab, 'id' | 'fileName' | 'kind' | 'text' | 'dirty'>>;
}

/**
 * The documents open in the editor, one per tab: files, examples, new diagrams, imported
 * agent graphs and models found by Import code base. Switching tabs keeps each document's
 * text, unsaved state, verification results and replayed trace.
 */
@Injectable({ providedIn: 'root' })
export class DocumentTabs {
    private readonly store = inject(DiagramStore);
    readonly tabs = signal<DocumentTab[]>([]);
    readonly active = signal(0);
    private nextId = 1;

    constructor() {
        const saved = readSaved();
        if (saved && saved.tabs.length > 0) {
            this.tabs.set(saved.tabs.map(t => ({ ...t, verification: null, trace: null, traceStep: 0 })));
            this.nextId = Math.max(...saved.tabs.map(t => t.id)) + 1;
            const active = saved.tabs.find(t => t.id === saved.active) ?? saved.tabs[0];
            this.active.set(active.id);
            this.restore(this.tabs().find(t => t.id === active.id)!);
        } else {
            // The store starts with the first example: that is the first tab.
            const id = this.nextId++;
            this.tabs.set([{ id, fileName: this.store.fileName(), kind: 'example', text: this.store.text(), dirty: false, verification: null, trace: null, traceStep: 0 }]);
            this.active.set(id);
        }
        // The active tab follows the store's name and unsaved state; everything is saved for the next visit.
        effect(() => {
            const fileName = this.store.fileName();
            const dirty = this.store.dirty();
            const text = this.store.text();
            untracked(() => {
                this.tabs.update(tabs => tabs.map(t => (t.id === this.active() ? { ...t, fileName, dirty, text } : t)));
                this.save();
            });
        });
    }

    /** Opens a document in a new tab, or shows the tab that already has exactly this document. */
    open(text: string, fileName: string, kind: DocumentKind): void {
        this.snapshot();
        const same = this.tabs().find(t => t.fileName === fileName && t.text === text);
        if (same) {
            this.activate(same.id);
            return;
        }
        const id = this.nextId++;
        this.tabs.update(tabs => [...tabs, { id, fileName, kind, text, dirty: false, verification: null, trace: null, traceStep: 0 }]);
        this.active.set(id);
        this.store.load(text, fileName);
        this.save();
    }

    newDiagram(): void {
        this.open(serializeDiagram(emptyDiagram('untitled')), this.freeName('untitled.pflow'), 'new');
    }

    openExample(id: string): void {
        const example = EXAMPLES.find(e => e.id === id) ?? EXAMPLES[0];
        this.open(example.source, `${example.id}.pflow`, 'example');
    }

    activate(id: number): void {
        if (id === this.active()) return;
        const target = this.tabs().find(t => t.id === id);
        if (!target) return;
        this.snapshot();
        this.active.set(id);
        this.restore(target);
        this.save();
    }

    /** Closes a tab (asking first if it has unsaved changes); the last tab is replaced by a new diagram. */
    close(id: number): void {
        const tab = this.tabs().find(t => t.id === id);
        if (!tab) return;
        const dirty = id === this.active() ? this.store.dirty() : tab.dirty;
        if (dirty && !confirm(`Close ${tab.fileName} without saving its changes?`)) return;
        const index = this.tabs().findIndex(t => t.id === id);
        const rest = this.tabs().filter(t => t.id !== id);
        if (rest.length === 0) {
            this.tabs.set([]);
            this.active.set(0);
            this.newDiagram();
            return;
        }
        this.tabs.set(rest);
        if (id === this.active()) {
            const next = rest[Math.min(index, rest.length - 1)];
            this.active.set(next.id);
            this.restore(next);
        }
        this.save();
    }

    /** Stores the active document's state in its tab before another one takes its place. */
    private snapshot(): void {
        const id = this.active();
        this.tabs.update(tabs =>
            tabs.map(t =>
                t.id === id
                    ? { ...t, fileName: this.store.fileName(), text: this.store.text(), dirty: this.store.dirty(), verification: this.store.verification(), trace: this.store.trace(), traceStep: this.store.traceStep() }
                    : t
            )
        );
    }

    private restore(tab: DocumentTab): void {
        this.store.load(tab.text, tab.fileName);
        this.store.dirty.set(tab.dirty);
        if (tab.verification && !tab.verification.running) this.store.verification.set(tab.verification);
        if (tab.trace) {
            this.store.trace.set(tab.trace);
            this.store.traceStep.set(tab.traceStep);
        }
    }

    private freeName(name: string): string {
        const taken = new Set(this.tabs().map(t => t.fileName));
        if (!taken.has(name)) return name;
        const base = name.replace(/\.pflow$/, '');
        for (let i = 2; ; i++) if (!taken.has(`${base}-${i}.pflow`)) return `${base}-${i}.pflow`;
    }

    private save(): void {
        try {
            const data: SavedTabs = { active: this.active(), tabs: this.tabs().map(({ id, fileName, kind, text, dirty }) => ({ id, fileName, kind, text, dirty })) };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch {
            // Storage full or unavailable: tabs simply do not survive a reload.
        }
    }
}

function readSaved(): SavedTabs | undefined {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const data = raw ? (JSON.parse(raw) as SavedTabs) : undefined;
        return data && Array.isArray(data.tabs) && data.tabs.every(t => typeof t.text === 'string' && typeof t.fileName === 'string') ? data : undefined;
    } catch {
        return undefined;
    }
}
