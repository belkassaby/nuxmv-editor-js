import { describe, expect, it } from 'vitest';
import { matchResults, normaliseProperty, parseNuxmvOutput } from '../src/index.js';

const OUTPUT = `*** This is nuXmv 2.2.0 (compiled on Mon Jun 29 2026)
-- specification AG (EF state = s0)  is true
-- specification  G (request ->  F status)  is false
-- as demonstrated by the following execution sequence
Trace Description: LTL Counterexample
Trace Type: Counterexample
  -> State: 1.1 <-
    state = s0
    request = FALSE
    status = TRUE
  -> State: 1.2 <-
    state = s1
    request = TRUE
    status = FALSE
  -- Loop starts here
  -> State: 1.3 <-
    request = FALSE
  -> State: 1.4 <-
    request = TRUE
-- invariant !(p1 = c & p2 = c)  is true
`;

describe('parseNuxmvOutput', () => {
    const parsed = parseNuxmvOutput(OUTPUT);

    it('extracts verdicts', () => {
        expect(parsed.results.map(r => [r.category, r.property, r.verdict])).toEqual([
            ['specification', 'AG (EF state = s0)', 'true'],
            ['specification', 'G (request -> F status)', 'false'],
            ['invariant', '!(p1 = c & p2 = c)', 'true']
        ]);
        expect(parsed.errors).toEqual([]);
    });

    it('attaches the counterexample with full valuations and the loop', () => {
        const trace = parsed.results[1].trace!;
        expect(trace.description).toBe('LTL Counterexample');
        expect(trace.steps.map(s => s.id)).toEqual(['1.1', '1.2', '1.3', '1.4']);
        expect(trace.steps[2].values).toEqual({ state: 's1', request: 'FALSE', status: 'FALSE' });
        expect(trace.steps[2].changed).toEqual(['request']);
        expect(trace.loopStart).toBe(2);
        expect(parsed.results[0].trace).toBeUndefined();
        expect(parsed.results[2].trace).toBeUndefined();
    });

    it('collects parser errors', () => {
        const { errors } = parseNuxmvOutput('', 'file model.smv: line 3: at token "}": syntax error\n');
        expect(errors).toHaveLength(1);
    });

    it('normalises properties for matching', () => {
        expect(normaliseProperty('AG EF state = s0')).toBe(normaliseProperty('AG (EF state = s0)'));
        expect(normaliseProperty('G(request -> F status)')).toBe(normaliseProperty(' G (request ->  F status)'));
    });
});

describe('bounded engines', () => {
    const IC3 = `-- specification AG !(p1 = c & p2 = c)  is true
-- no proof or counterexample found with bound 4
-- no proof or counterexample found with bound 5
-- invariant !(p1 = c & p2 = c)  is true
-- no proof or counterexample found with bound 4
-- no proof or counterexample found with bound 6
-- LTL specification  G (p1 = t ->  F p1 = c)  is false
-- as demonstrated by the following execution sequence
Trace Description: IC3 counterexample 
Trace Type: Counterexample 
  -> State: 1.1 <-
    p1 = n
    state = s0
`;
    const BMC = `-- no counterexample found with bound 0
-- no counterexample found with bound 1
-- no counterexample found with bound 0
-- no counterexample found with bound 1
-- specification  G p   is false
`;

    it('treats bound progress lines as progress, not verdicts', () => {
        const { results } = parseNuxmvOutput(IC3);
        expect(results.map(r => r.verdict)).toEqual(['true', 'true', 'false']);
        expect(results[2].trace?.steps).toHaveLength(1);
    });

    it('reports properties without verdict as unknown', () => {
        const { results } = parseNuxmvOutput(BMC);
        expect(results.map(r => r.verdict)).toEqual(['unknown', 'false']);
        expect(results[0].detail).toMatch(/bound 1/);
    });

    it('matches results to specifications regardless of order', () => {
        const specs = [
            { kind: 'LTLSPEC', expression: 'G (p1 = t -> F p1 = c)' },
            { kind: 'INVARSPEC', expression: '!(p1 = c & p2 = c)' },
            { kind: 'CTLSPEC', expression: 'AG !(p1 = c & p2 = c)' }
        ];
        const matched = matchResults(specs, parseNuxmvOutput(IC3).results);
        expect(matched.map(r => r?.verdict)).toEqual(['false', 'true', 'true']);
        expect(matched[1]?.category).toBe('invariant');
    });
});
