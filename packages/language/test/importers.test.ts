import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, exportToFramework, importGraph, parseDiagram, serializeDiagram } from '../src/index.js';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'imports', name), 'utf8');
const edges = (text: string) => importGraph(text).model.transitions.map(t => `${t.source}->${t.target}${t.label ? ` (${t.label})` : ''}`).sort();

describe('importers', () => {
    const langgraph = ['agent->finished (finish)', 'agent->human (ask)', 'agent->tools (call_tool)', 'finished->finished', 'human->agent', 'tools->agent'];

    it('reads LangGraph get_graph().to_json(), draw_mermaid() and source the same way', () => {
        for (const [file, format] of [['langgraph.json', 'langgraph-json'], ['langgraph.mmd', 'mermaid'], ['langgraph_source.py', 'langgraph-python']] as const) {
            const r = importGraph(fixture(file));
            expect(r.format).toBe(format);
            expect(edges(fixture(file))).toEqual(langgraph);
            expect(r.model.states.filter(s => s.initial).map(s => s.name)).toEqual(['agent']);
        }
    });

    it('reads CrewAI Flow routers and listeners', () => {
        expect(edges(fixture('crewai_flow.py'))).toEqual(['draft->review', 'review->publish (approved)', 'review->revise (rejected)', 'revise->redraft']);
        expect(importGraph(fixture('crewai_flow.py')).model.states.find(s => s.initial)?.name).toBe('draft');
    });

    it('reads Mermaid state diagrams with aliases and final states', () => {
        const { model } = importGraph(fixture('state_diagram.mmd'));
        expect(model.states.find(s => s.name === 'Approval')?.label).toBe('Waiting for approval');
        expect(edges(fixture('state_diagram.mmd'))).toContain('Done->Done');
        expect(model.states.find(s => s.initial)?.name).toBe('Idle');
    });

    it('round-trips an XState export', async () => {
        const original = (await parseDiagram(EXAMPLES.find(e => e.id === 'agent-coding-loop')!.source)).model;
        const code = (await exportToFramework(original, 'xstate')).code;
        const { model } = importGraph(`createMachine(${code.slice(code.indexOf('.createMachine(') + 15, code.lastIndexOf(');'))})`);
        expect(model.states.map(s => s.name).sort()).toEqual(original.states.map(s => s.name).sort());
        expect(model.transitions).toHaveLength(original.transitions.length);
    });

    it.each(['langgraph.json', 'langgraph.mmd', 'langgraph_source.py', 'crewai_flow.py', 'state_diagram.mmd'])('%s produces a valid diagram', async file => {
        const parsed = await parseDiagram(serializeDiagram(importGraph(fixture(file)).model));
        expect(parsed.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    });

    it('refuses unknown formats', () => {
        expect(() => importGraph('hello world')).toThrow(/Unrecognised format/);
    });
});
