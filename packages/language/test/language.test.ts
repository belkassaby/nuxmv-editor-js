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
            variables: [],
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

    it('accepts single-letter operator names as diagram name', async () => {
        for (const name of ['T', 'S', 'O', 'G']) {
            const outcome = await parseDiagram(`diagram ${name}\ninitial state a\na -> a;`);
            expect(outcome.hasErrors).toBe(false);
            expect(outcome.model.name).toBe(name);
        }
    });

    it('parses temporal operators with nuXmv precedence', async () => {
        const { ast } = await parseDiagram('attributes { p : boolean; s : { a, b }; }\nstate s0 { p = TRUE, s = a }\ns0 -> s0;\nLTLSPEC G (p -> F s = b);\nLTLSPEC ! F p & X s = a;');
        const specs = ast.elements.filter(e => e.$type === 'Specification');
        const shape = (e: any): string =>
            e.$type === 'BinaryExpression' ? `(${shape(e.left)} ${e.operator} ${shape(e.right)})`
            : e.$type === 'UnaryExpression' ? `${e.operator}[${shape(e.operand)}]`
            : e.$type === 'NameReference' ? e.name : String(e.value ?? e.$type);
        expect(shape((specs[0] as any).expression)).toBe('G[(p -> F[(s = b)])]');
        expect(shape((specs[1] as any).expression)).toBe('(![F[p]] & X[(s = a)])');
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
        expect(await messages(base + 'LTLSPEC G (p -> O p) & H (Y p -> p) & (p S p) & (p T p) & Z p;')).toEqual([]);
        expect(await messages(base + 'CTLSPEC AG O p;')).toHaveLength(1);
        expect(await messages(base + 'INVARSPEC Y p;')).toHaveLength(1);
    });

    it('warns about dead ends, missing initial states and duplicates', async () => {
        const warnings = await messages('state s0\nstate s1\ns0 -> s1;\ns0 -> s1;', 'warning');
        expect(warnings.join('\n')).toMatch(/No initial state/);
        expect(warnings.join('\n')).toMatch(/'s1' is a dead end/);
        expect(warnings.join('\n')).toMatch(/Duplicate transition/);
        expect(await messages('state s0\nstate s0\ns0 -> s0;')).toEqual(['Duplicate state \'s0\'.']);
    });
});

describe('guards and data', () => {
    const source = EXAMPLES.find(e => e.id === 'agent-retry-data')!.source;

    it('parses variables, guards, updates and probabilities', async () => {
        const { model } = await parseDiagram(source);
        expect(model.variables).toEqual([
            { name: 'retries', type: { kind: 'range', low: 0, high: 3 }, initial: '0' },
            { name: 'approved', type: { kind: 'boolean' }, initial: 'FALSE' }
        ]);
        const failed = model.transitions.find(t => t.label === 'tests_failed')!;
        expect(failed.guard).toBe('retries < 2');
        expect(failed.updates).toEqual([{ variable: 'retries', expression: 'retries + 1' }]);
        expect(failed.probability).toBe(0.3);
    });

    it('encodes the transition relation with TRANS', async () => {
        const { model } = await parseDiagram(source);
        const { text } = generateSmv(model);
        expect(text).toContain('init(retries) := 0;');
        expect(text).toContain('retries : 0..3;');
        expect(text).toMatch(/TRANS\n/);
        expect(text).toContain('(state = test & (retries < 2) & (retries + 1) >= 0 & (retries + 1) <= 3 & next(state) = work & next(retries) = (retries + 1) & next(approved) = approved)');
        expect(text).toContain('nothing enabled: stutter');
        expect(text).not.toContain('next(state) := case');
    });

    it('validates guards, updates, initial values and probabilities', async () => {
        const errs = async (t: string) => (await parseDiagram(t)).diagnostics.filter(d => d.severity === 'error').map(d => d.message);
        const base = 'variables { n : 0..2 := 0; }\ninitial state a\n';
        expect(await errs(base + 'a -> a when G n > 0;')).toEqual([expect.stringMatching(/guard must be a condition/i)]);
        expect(await errs(base + 'a -> a do m := 1;')).toHaveLength(1);
        expect(await errs(base + 'a -> a do n := n + 1, n := 0;')).toEqual([expect.stringMatching(/updated twice/)]);
        expect(await errs(base + 'a -> a prob 1.5;')).toEqual([expect.stringMatching(/probability/)]);
        expect(await errs('variables { n : 0..2 := 5; }\ninitial state a\na -> a;')).toEqual([expect.stringMatching(/outside 0..2/)]);
        const warnings = (await parseDiagram(base + 'state b\na -> a prob 0.5;\na -> b prob 0.2;\nb -> a;')).diagnostics.filter(d => d.severity === 'warning');
        expect(warnings.map(w => w.message).join()).toMatch(/add up to 0.7/);
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
