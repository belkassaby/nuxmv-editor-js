import { describe, expect, it } from 'vitest';
import {
    EXAMPLES,
    generateSmv,
    GenerationError,
    importLegacyAttributes,
    parseDiagram,
    serializeDiagram,
    emptyDiagram,
    type DiagramModel
} from '../src/index.js';

const errors = (outcome: Awaited<ReturnType<typeof parseDiagram>>) => outcome.diagnostics.filter(d => d.severity === 'error');

describe('parser', () => {
    it.each(EXAMPLES.map(e => [e.id, e.source]))('parses example %s without errors', async (_id, source) => {
        const outcome = await parseDiagram(source);
        expect(errors(outcome)).toEqual([]);
        expect(outcome.model.states.length).toBeGreaterThan(0);
    });

    it.each(EXAMPLES.map(e => [e.id, e]))('declares an expected verdict for every property of %s', async (_id, example) => {
        const { model, diagnostics } = await parseDiagram(example.source);
        expect(model.specs).toHaveLength(example.expected.length);
        expect(diagnostics.filter(d => d.severity === 'warning')).toEqual([]);
    });

    it('builds the diagram model', async () => {
        const { model } = await parseDiagram(`
            diagram M
            attributes { a : boolean; n : 0..3; e : { x, y }; }
            initial state s0 "start" { a = TRUE, n = 2, e = y } at (10, -20)
            state s1
            s0 -> s1 : "go";
            s1 -> s0;
            FAIRNESS a;
            LTLSPEC NAME p := G (a -> F e = x);
        `);
        expect(model).toEqual<DiagramModel>({
            name: 'M',
            attributes: [
                { name: 'a', type: { kind: 'boolean' } },
                { name: 'n', type: { kind: 'range', low: 0, high: 3 } },
                { name: 'e', type: { kind: 'enum', values: ['x', 'y'] } }
            ],
            states: [
                { name: 's0', label: 'start', initial: true, values: { a: 'TRUE', n: '2', e: 'y' }, position: { x: 10, y: -20 } },
                { name: 's1', initial: false, values: {} }
            ],
            transitions: [
                { source: 's0', target: 's1', label: 'go' },
                { source: 's1', target: 's0' }
            ],
            fairness: [{ kind: 'FAIRNESS', expression: 'a' }],
            specs: [{ kind: 'LTLSPEC', name: 'p', expression: 'G (a -> F e = x)' }]
        });
    });

    it('reports syntax errors', async () => {
        const outcome = await parseDiagram('state s0 {');
        expect(outcome.hasSyntaxErrors).toBe(true);
        expect(outcome.hasErrors).toBe(true);
    });

    it('resolves transitions to declared states only', async () => {
        const outcome = await parseDiagram('state s0\ns0 -> s9;');
        expect(errors(outcome).map(d => d.message).join()).toMatch(/s9/);
    });
});

describe('validator', () => {
    const messages = async (text: string, severity = 'error') =>
        (await parseDiagram(text)).diagnostics.filter(d => d.severity === severity).map(d => d.message);

    it('checks attribute values against their type', async () => {
        const found = await messages(`
            attributes { a : boolean; n : 0..3; e : { x, y }; }
            state s0 { a = 3, n = 7, e = z }
            s0 -> s0;
        `);
        expect(found).toHaveLength(3);
    });

    it('rejects nuXmv reserved words as names', async () => {
        const found = await messages('attributes { count : 0..3; e : { init, ok }; }\nstate next\nnext -> next;');
        expect(found).toHaveLength(3);
        expect(found.join()).toMatch(/'count' is a reserved word/);
    });

    it('rejects unknown names in properties', async () => {
        expect(await messages('state s0\ns0 -> s0;\nLTLSPEC G foo;')).toEqual([expect.stringMatching(/Unknown name 'foo'/)]);
    });

    it('rejects CTL operators in LTL specs and vice versa', async () => {
        const base = 'attributes { p : boolean; }\nstate s0 { p = TRUE }\ns0 -> s0;\n';
        expect(await messages(base + 'LTLSPEC AG p;')).toHaveLength(1);
        expect(await messages(base + 'LTLSPEC E [ p U p ];')).toHaveLength(1);
        expect(await messages(base + 'CTLSPEC G p;')).toHaveLength(1);
        expect(await messages(base + 'CTLSPEC A [ p U !p ];')).toEqual([]);
        expect(await messages(base + 'INVARSPEC F p;')).toHaveLength(1);
        expect(await messages(base + 'FAIRNESS G p;')).toHaveLength(1);
    });

    it('warns about dead ends, missing initial states and duplicates', async () => {
        const warnings = await messages('state s0\nstate s1\ns0 -> s1;\ns0 -> s1;', 'warning');
        expect(warnings.join('\n')).toMatch(/No initial state/);
        expect(warnings.join('\n')).toMatch(/'s1' is a dead end/);
        expect(warnings.join('\n')).toMatch(/Duplicate transition/);
        expect(await messages('state s0\nstate s0\ns0 -> s0;')).toEqual(['Duplicate state \'s0\'.']);
    });
});

describe('serializer', () => {
    it.each(EXAMPLES.map(e => [e.id, e.source]))('round-trips example %s', async (_id, source) => {
        const first = (await parseDiagram(source)).model;
        const text = serializeDiagram(first);
        const second = await parseDiagram(text);
        expect(errors(second)).toEqual([]);
        expect(second.model).toEqual(first);
    });
});

describe('nuXmv generator', () => {
    it('generates the sequential style model of the dissertation', async () => {
        const { model } = await parseDiagram(EXAMPLES[0].source);
        const { text } = generateSmv(model);
        expect(text).toContain('state : {s0, s1, s2, s3};');
        expect(text).toContain('status : {ready, busy};');
        expect(text).toContain('request : boolean;');
        expect(text).toContain('init(state) := s0;');
        expect(text).toContain('state = s0 : {s1, s3};');
        expect(text).toContain('state = s2 : {s0, s1, s2, s3};');
        expect(text).toMatch(/status := case\s+state = s0 : ready;\s+state = s1 : busy;/);
        expect(text).toContain('LTLSPEC\n    G (request -> F status = ready);');
    });

    it('supports several initial states and dead ends', () => {
        const model: DiagramModel = {
            ...emptyDiagram(),
            attributes: [{ name: 'p', type: { kind: 'boolean' } }],
            states: [
                { name: 'a', initial: true, values: { p: 'TRUE' } },
                { name: 'b', initial: true, values: {} }
            ],
            transitions: [{ source: 'a', target: 'b' }]
        };
        const { text, notes } = generateSmv(model);
        expect(text).toContain('init(state) := {a, b};');
        expect(text).toContain('state = b : b; -- dead end: stutter');
        expect(text).toContain('TRUE : {TRUE, FALSE};');
        expect(notes.join()).toMatch(/Dead-end/);
    });

    it('refuses empty diagrams', () => {
        expect(() => generateSmv(emptyDiagram())).toThrow(GenerationError);
    });
});

describe('legacy attributeData.txt import', () => {
    it('reads the Appendix A example', () => {
        const model = importLegacyAttributes(
            `//attribNameList
p q r
//attribValuesList
TRUE FALSE
TRUE FALSE
TRUE FALSE
//stateAttribValue
TRUE FALSE FALSE
TRUE TRUE FALSE
FALSE TRUE TRUE
`,
            emptyDiagram()
        );
        expect(model.attributes.map(a => a.name)).toEqual(['p', 'q', 'r']);
        expect(model.states.map(s => s.values)).toEqual([
            { p: 'TRUE', q: 'TRUE', r: 'FALSE' },
            { p: 'FALSE', q: 'TRUE', r: 'TRUE' },
            { p: 'FALSE', q: 'FALSE', r: 'TRUE' }
        ]);
        expect(model.states[0].initial).toBe(true);
    });
});
