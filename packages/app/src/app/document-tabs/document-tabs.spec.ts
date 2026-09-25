import { TestBed } from '@angular/core/testing';
import { DiagramStore } from '../diagram-store';
import { DocumentTabs } from './document-tabs';

const settle = () => new Promise(resolve => setTimeout(resolve, 60));

describe('DocumentTabs', () => {
    let tabs: DocumentTabs;
    let store: DiagramStore;

    beforeEach(async () => {
        localStorage.removeItem('provenflow.tabs');
        TestBed.resetTestingModule();
        store = TestBed.inject(DiagramStore);
        tabs = TestBed.inject(DocumentTabs);
        await settle();
    });

    it('starts with the example the editor shows', () => {
        expect(tabs.tabs().length).toBe(1);
        expect(tabs.tabs()[0].fileName).toBe(store.fileName());
    });

    it('opens each document in its own tab and keeps its text, unsaved state and results', async () => {
        tabs.open('diagram A\ninitial state a\na -> a;\n', 'a.pflow', 'code');
        await settle();
        store.setText('diagram A\ninitial state a\nstate b\na -> b;\nb -> a;\n');
        await store.settled();
        store.dirty.set(true);
        store.verification.set({ running: false, model: store.generated().text, results: [], errors: [], warnings: [] } as never);
        tabs.open('diagram B\ninitial state x\nx -> x;\n', 'b.pflow', 'code');
        await settle();
        expect(tabs.tabs().map(t => t.fileName)).toEqual([tabs.tabs()[0].fileName, 'a.pflow', 'b.pflow']);
        expect(store.fileName()).toBe('b.pflow');
        expect(store.model().states.map(s => s.name)).toEqual(['x']);

        tabs.activate(tabs.tabs()[1].id);
        await settle();
        expect(store.fileName()).toBe('a.pflow');
        expect(store.model().states.map(s => s.name)).toEqual(['a', 'b']);
        expect(store.dirty()).toBe(true);
        expect(store.verification()?.stale).toBeFalsy();
        expect(store.verification()).not.toBeNull();
    });

    it('shows the existing tab when the same document is opened again', async () => {
        tabs.open('diagram A\ninitial state a\na -> a;\n', 'a.pflow', 'code');
        tabs.openExample('mutex');
        tabs.open('diagram A\ninitial state a\na -> a;\n', 'a.pflow', 'code');
        await settle();
        expect(tabs.tabs().filter(t => t.fileName === 'a.pflow').length).toBe(1);
        expect(store.fileName()).toBe('a.pflow');
    });

    it('closes tabs, and replaces the last one with a new diagram', async () => {
        const first = tabs.tabs()[0].id;
        tabs.close(first);
        await settle();
        expect(tabs.tabs().length).toBe(1);
        expect(tabs.tabs()[0].kind).toBe('new');
    });

    it('restores the open documents after a reload', async () => {
        tabs.open('diagram A\ninitial state a\na -> a;\n', 'a.pflow', 'code');
        await settle();
        const saved = JSON.parse(localStorage.getItem('provenflow.tabs')!);
        expect(saved.tabs.map((t: { fileName: string }) => t.fileName)).toContain('a.pflow');
        expect(saved.active).toBe(tabs.active());
    });
});
