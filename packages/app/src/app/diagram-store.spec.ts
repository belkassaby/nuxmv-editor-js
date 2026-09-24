import { TestBed } from '@angular/core/testing';
import { DiagramStore } from './diagram-store';

const settle = () => new Promise(resolve => setTimeout(resolve, 50));

describe('DiagramStore', () => {
    let store: DiagramStore;

    beforeEach(async () => {
        store = TestBed.inject(DiagramStore);
        await settle();
    });

    it('loads the first example on start', () => {
        expect(store.model().states.length).toBe(4);
        expect(store.generated().text).toContain('MODULE main');
    });

    it('serialises diagram edits back to text', async () => {
        store.newDiagram();
        store.addState({ x: 10, y: 20 });
        await settle();
        store.addTransition('s0', 's0');
        expect(store.text()).toContain('initial state s0 at (10, 20)');
        expect(store.text()).toContain('s0 -> s0;');
    });

    it('parses text edits into the model', async () => {
        store.setText('diagram T\ninitial state a\nstate b\na -> b;\nb -> a;\n');
        await new Promise(resolve => setTimeout(resolve, 400));
        expect(store.model().states.map(s => s.name)).toEqual(['a', 'b']);
        expect(store.model().transitions).toHaveLength(2);
    });

    it('keeps the last good model and refuses diagram edits while the text has syntax errors', async () => {
        store.setText('diagram T\nstate a\nstate {');
        await new Promise(resolve => setTimeout(resolve, 400));
        expect(store.hasSyntaxErrors()).toBe(true);
        expect(store.model().states.length).toBe(4);
        store.addState();
        expect(store.text()).toBe('diagram T\nstate a\nstate {');
        expect(store.notice()).toMatch(/syntax errors/);
    });

    it('does not lose typed text when the diagram is edited right after', async () => {
        store.setText('diagram T\ninitial state a\n');
        store.addState();
        await settle();
        expect(store.model().states.map(s => s.name)).toEqual(['a', 's0']);
        expect(store.text()).toContain('initial state a');
    });

    it('renames states everywhere', () => {
        const error = store.renameState('s0', 'start');
        expect(error).toBeNull();
        expect(store.model().transitions.some(t => t.source === 'start')).toBe(true);
        expect(store.renameState('s1', 's2')).toMatch(/already exists/);
    });

    it('simulates the diagram', () => {
        store.startSimulation();
        expect(store.highlight()?.path).toEqual(['s0']);
        expect(store.highlight()?.candidates).toEqual(['s1', 's3']);
        store.simulateTo('s3');
        expect(store.simulation()).toEqual(['s0', 's3']);
    });
});
