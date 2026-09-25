/** Reference material on symbolic logic shown in the Help window. */

export interface LogicSymbol {
    /** Textbook notation. */
    symbol: string;
    /** Spelling in nuXmv / .pflow, or '' when it has no direct syntax. */
    syntax: string;
    name: string;
    meaning: string;
    logic: 'Propositional' | 'LTL' | 'CTL' | 'Meta';
}

export interface GlossaryTerm {
    term: string;
    /** Other names or notations, also used by the search. */
    aka?: string;
    definition: string;
    /** Formula or snippet in .pflow syntax. */
    example?: string;
}

export interface Reference {
    title: string;
    url: string;
    note: string;
}

export const SYMBOLS: LogicSymbol[] = [
    { symbol: '¬ p', syntax: '!p', name: 'negation (not)', meaning: 'True when p is false.', logic: 'Propositional' },
    { symbol: 'p ∧ q', syntax: 'p & q', name: 'conjunction (and)', meaning: 'True when both p and q are true.', logic: 'Propositional' },
    { symbol: 'p ∨ q', syntax: 'p | q', name: 'disjunction (or)', meaning: 'True when at least one of p, q is true.', logic: 'Propositional' },
    { symbol: 'p ⊕ q', syntax: 'p xor q', name: 'exclusive or', meaning: 'True when exactly one of p, q is true.', logic: 'Propositional' },
    { symbol: 'p → q', syntax: 'p -> q', name: 'implication', meaning: 'If p then q; false only when p is true and q false.', logic: 'Propositional' },
    { symbol: 'p ↔ q', syntax: 'p <-> q', name: 'equivalence (iff)', meaning: 'True when p and q have the same truth value.', logic: 'Propositional' },
    { symbol: '⊤ / ⊥', syntax: 'TRUE / FALSE', name: 'truth constants', meaning: 'Always true / always false.', logic: 'Propositional' },
    { symbol: 'X p, ○ p', syntax: 'X p', name: 'next', meaning: 'p holds in the next state of the path.', logic: 'LTL' },
    { symbol: 'G p, □ p', syntax: 'G p', name: 'globally (always)', meaning: 'p holds in every state of the path, from now on.', logic: 'LTL' },
    { symbol: 'F p, ◇ p', syntax: 'F p', name: 'finally (eventually)', meaning: 'p holds in some present or future state of the path.', logic: 'LTL' },
    { symbol: 'p U q', syntax: 'p U q', name: 'until', meaning: 'q eventually holds, and p holds in every state before that.', logic: 'LTL' },
    { symbol: 'p R q', syntax: 'p V q', name: 'release', meaning: 'q holds up to and including the first state where p holds; if p never holds, q holds forever. Dual of U: p V q ≡ ¬(¬p U ¬q).', logic: 'LTL' },
    { symbol: 'G F p, □◇ p', syntax: 'G F p', name: 'infinitely often', meaning: 'p holds again and again, forever (a recurrence / liveness pattern).', logic: 'LTL' },
    { symbol: 'F G p, ◇□ p', syntax: 'F G p', name: 'eventually always', meaning: 'From some point on, p holds forever (stabilisation).', logic: 'LTL' },
    { symbol: 'Y p, ⊖ p', syntax: 'Y p', name: 'previous (yesterday)', meaning: 'Past-time: p held in the previous state. False in the initial state.', logic: 'LTL' },
    { symbol: 'Z p', syntax: 'Z p', name: 'weak previous', meaning: 'Past-time: p held in the previous state, or this is the initial state.', logic: 'LTL' },
    { symbol: 'O p, ◈ p', syntax: 'O p', name: 'once', meaning: 'Past-time: p held in some state from the start up to now.', logic: 'LTL' },
    { symbol: 'H p, ⊟ p', syntax: 'H p', name: 'historically', meaning: 'Past-time: p held in every state from the start up to now.', logic: 'LTL' },
    { symbol: 'p S q', syntax: 'p S q', name: 'since', meaning: 'Past-time: q held at some point, and p has held ever since.', logic: 'LTL' },
    { symbol: 'p T q', syntax: 'p T q', name: 'triggered', meaning: 'Past-time dual of S: q has held ever since p last held (or always, if p never held).', logic: 'LTL' },
    { symbol: 'A φ, ∀', syntax: 'A', name: 'for all paths', meaning: 'Path quantifier: φ holds on every path from the current state.', logic: 'CTL' },
    { symbol: 'E φ, ∃', syntax: 'E', name: 'there exists a path', meaning: 'Path quantifier: φ holds on at least one path from the current state.', logic: 'CTL' },
    { symbol: 'AX p', syntax: 'AX p', name: 'all next', meaning: 'p holds in every successor state.', logic: 'CTL' },
    { symbol: 'EX p', syntax: 'EX p', name: 'exists next', meaning: 'p holds in at least one successor state.', logic: 'CTL' },
    { symbol: 'AG p', syntax: 'AG p', name: 'invariantly', meaning: 'p holds in every state reachable on every path.', logic: 'CTL' },
    { symbol: 'EG p', syntax: 'EG p', name: 'potentially always', meaning: 'Some path exists along which p holds forever.', logic: 'CTL' },
    { symbol: 'AF p', syntax: 'AF p', name: 'inevitably', meaning: 'Every path eventually reaches a state where p holds.', logic: 'CTL' },
    { symbol: 'EF p', syntax: 'EF p', name: 'possibly (reachable)', meaning: 'Some path reaches a state where p holds.', logic: 'CTL' },
    { symbol: 'A[p U q]', syntax: 'A [ p U q ]', name: 'all-paths until', meaning: 'On every path, p holds until q holds (and q eventually holds).', logic: 'CTL' },
    { symbol: 'E[p U q]', syntax: 'E [ p U q ]', name: 'exists-path until', meaning: 'Some path exists on which p holds until q holds.', logic: 'CTL' },
    { symbol: 'M, s ⊨ φ', syntax: '', name: 'satisfies (models)', meaning: 'Formula φ is true in state s of model M. Model checking decides this.', logic: 'Meta' },
    { symbol: 'M, s ⊭ φ', syntax: '', name: 'does not satisfy', meaning: 'φ is false in s; nuXmv then reports a counterexample when it can.', logic: 'Meta' },
    { symbol: 's → s′', syntax: 's -> t;', name: 'transition', meaning: 'The system can move from state s to state s′ in one step.', logic: 'Meta' },
    { symbol: 'L(s)', syntax: 'state s { p = TRUE }', name: 'labelling function', meaning: 'The set of atoms (attribute values) true in state s.', logic: 'Meta' },
    { symbol: '≡', syntax: '', name: 'logical equivalence', meaning: 'Two formulas are true in exactly the same situations, e.g. F p ≡ TRUE U p, AG p ≡ ¬EF ¬p.', logic: 'Meta' }
];

export const GLOSSARY: GlossaryTerm[] = [
    { term: 'Atom (atomic proposition)', aka: 'atomic formula, attribute', definition: 'A basic statement about a single state that is either true or false, with no connectives inside. Here, an attribute value such as request = TRUE or status = busy.', example: 'status = ready' },
    { term: 'Proposition / formula', aka: 'well-formed formula, wff', definition: 'An expression built from atoms with connectives (¬ ∧ ∨ → ↔) and, in temporal logic, temporal operators.' },
    { term: 'Propositional logic', aka: 'sentential logic, Boolean logic', definition: 'The logic of atoms combined with not, and, or, implies and iff. It talks about one state and has no notion of time.' },
    { term: 'Temporal logic', definition: 'Propositional logic extended with operators that talk about how truth changes over time along the executions of a system: next, always, eventually, until.' },
    { term: 'LTL (Linear Temporal Logic)', aka: 'LTLSPEC', definition: 'Temporal logic over single infinite paths. An LTL property holds in a model if it holds on every path starting in an initial state. Operators: X, G, F, U, V.', example: 'LTLSPEC G (request -> F status = busy);' },
    { term: 'Past-time LTL', aka: 'PLTL, Y Z O H S T', definition: 'LTL extended with operators that look backwards along the path: previous, once, historically, since. They make "B only after A" guardrails easy to state and are supported by nuXmv in LTLSPEC only.', example: 'LTLSPEC G (phase = deployed -> O phase = code_review);' },
    { term: 'CTL (Computation Tree Logic)', aka: 'CTLSPEC', definition: 'Branching-time temporal logic over the tree of all possible futures. Every temporal operator is paired with a path quantifier: A (all paths) or E (some path).', example: 'CTLSPEC AG EF state = s0;' },
    { term: 'CTL*', definition: 'The logic that contains both LTL and CTL: path quantifiers and temporal operators can be freely mixed. nuXmv checks the LTL and CTL fragments. LTL and CTL are incomparable: each expresses properties the other cannot.' },
    { term: 'Invariant', aka: 'INVARSPEC, state invariant', definition: 'A propositional formula that must hold in every reachable state. Equivalent to AG p in CTL or G p in LTL, but checked by dedicated, often faster, algorithms.', example: 'INVARSPEC !(p1 = c & p2 = c);' },
    { term: 'Safety property', definition: '"Something bad never happens." Violated by a finite prefix of an execution, so its counterexample is a finite path to a bad state.', example: 'CTLSPEC AG !(p1 = c & p2 = c);' },
    { term: 'Liveness property', definition: '"Something good eventually happens." Can only be violated by an infinite execution, so its counterexample is a lasso that loops forever without the good thing.', example: 'G (request -> F granted)' },
    { term: 'Reachability', definition: 'Whether some state satisfying p can be reached from an initial state: EF p. A false EF p means p is unreachable, for example dead code.', example: 'CTLSPEC EF state = done;' },
    { term: 'Fairness constraint', aka: 'FAIRNESS, JUSTICE, weak fairness', definition: 'An assumption that restricts verification to fair paths, on which the given formula holds infinitely often. Used to discard unrealistic runs, e.g. a scheduler that never picks a process.', example: 'FAIRNESS start & close & !error;' },
    { term: 'Kripke structure', aka: 'M = (S, S₀, →, L), transition system, model', definition: 'The mathematical model checked by nuXmv: a set of states S, initial states S₀, a transition relation → and a labelling function L giving the atoms true in each state. Every state must have at least one successor.' },
    { term: 'State', aka: 'world, vertex, node', definition: 'One configuration of the system. In the diagram, a circle; in nuXmv, one value of the variable state together with the attribute values of that state.' },
    { term: 'Initial state', aka: 'S₀', definition: 'A state in which executions may start. Properties are checked from every initial state (double border on the diagram).' },
    { term: 'Transition relation', aka: '→, edge, arc', definition: 'The set of allowed moves between states. A state with several outgoing transitions is nondeterministic: any of them may be taken.' },
    { term: 'Labelling function', aka: 'L(s), valuation', definition: 'Assigns to each state the atoms true in it. In the editor, the values given to the attributes of each state.' },
    { term: 'Path', aka: 'execution, run, computation', definition: 'An infinite sequence of states s₀ → s₁ → s₂ → … that follows the transition relation.' },
    { term: 'Trace', definition: 'A sequence of states produced by the model checker or the simulator. nuXmv prints only the variables that change at each step.' },
    { term: 'Counterexample', definition: 'A path that violates a property: the evidence nuXmv gives for a false verdict. Replay it on the diagram with the Counterexample button.' },
    { term: 'Witness', definition: 'A path showing that an existential property (EF, EG, E[..U..]) holds. It is the dual of a counterexample.' },
    { term: 'Lasso', aka: 'loop, prefix + cycle', definition: 'The shape of counterexamples to liveness properties: a finite prefix followed by a cycle repeated forever. "Loop starts here" in the trace marks the start of the cycle.' },
    { term: 'Deadlock / dead end', definition: 'A state with no outgoing transition. Kripke structures need every path to be infinite, so the editor makes dead ends loop on themselves and warns about them. AG EX TRUE checks that no deadlock is reachable.' },
    { term: 'Nondeterminism', definition: 'The system may take any of several transitions and the choice is not specified. The model checker explores all choices, which is how uncontrolled behaviour such as an LLM decision or a human answer is modelled.' },
    { term: 'Satisfaction (⊨)', aka: 'models, holds', definition: 'M, s ⊨ φ reads "φ is true in state s of model M". A model satisfies a property when every initial state does.' },
    { term: 'Model checking', definition: 'Automatically deciding M ⊨ φ by exhaustively exploring the states of a finite model. It either proves the property or produces a counterexample.' },
    { term: 'Symbolic model checking', definition: 'Representing and exploring sets of states with formulas or data structures (BDDs, SAT) instead of listing them one by one. It makes very large state spaces tractable.' },
    { term: 'BDD (Binary Decision Diagram)', aka: 'OBDD, BDD engine', definition: 'A compact canonical graph representation of Boolean functions. The default nuXmv engine computes reachable states and fixpoints with BDDs and gives exact answers for LTL, CTL and invariants.' },
    { term: 'BMC (Bounded Model Checking)', definition: 'Searches for counterexamples of length at most k with a SAT solver. It finds short bugs fast but cannot prove a property: "no counterexample up to bound k" is inconclusive.' },
    { term: 'IC3 / PDR', aka: 'Property Directed Reachability', definition: 'A SAT-based algorithm that proves invariants (and LTL via reduction) by incrementally building an inductive invariant, without unrolling the model.' },
    { term: 'Fixpoint', aka: 'fixed point, μ / ν', definition: 'A set of states that no longer changes when an operation is applied again. CTL operators are computed as fixpoints: EF p is the least fixpoint of p ∨ EX Z, EG p the greatest fixpoint of p ∧ EX Z.' },
    { term: 'Tautology', aka: 'valid formula', definition: 'A formula true under every assignment of its atoms, e.g. p ∨ ¬p. A property that is a tautology tells nothing about the model.' },
    { term: 'Contradiction', aka: 'unsatisfiable formula', definition: 'A formula false under every assignment, e.g. p ∧ ¬p.' },
    { term: 'Duality', definition: 'Pairs of operators that are interdefinable through negation: G p ≡ ¬F ¬p, AG p ≡ ¬EF ¬p, AX p ≡ ¬EX ¬p, p V q ≡ ¬(¬p U ¬q).' },
    { term: 'Guard', aka: 'when', definition: 'A condition on a transition: it can only fire in configurations where the condition holds. Guards read attributes and variables of the current state.', example: 'test -> work when retries < 2;' },
    { term: 'Update', aka: 'do, assignment', definition: 'A change of data variables performed by a transition (all updates of a transition are simultaneous). A transition whose updates would leave a variable\'s range is disabled.', example: 'do retries := retries + 1' },
    { term: 'Configuration', definition: 'The control state together with the values of the data variables: what the simulator, the probabilistic analysis and the runtime track.' },
    { term: 'Stutter', definition: 'Staying in the same configuration. In this editor a configuration where no transition is enabled stutters, so every path is infinite as model checking requires.' },
    { term: 'DTMC (discrete-time Markov chain)', aka: 'Markov chain, probabilistic model', definition: 'A transition system whose transitions carry probabilities. Here, obtained from the diagram with the prob annotations; used to compute reachability probabilities and expected steps.', example: 'P(F phase = done), E[steps until phase = done]' },
    { term: 'PCTL', aka: 'probabilistic CTL, P=? [ F goal ]', definition: 'The logic of probabilistic model checkers such as PRISM and Storm: probability and reward operators over paths.' },
    { term: 'Runtime verification', aka: 'runtime monitoring', definition: 'Checking properties on the execution of a real system, step by step, rather than on all executions of a model.' },
    { term: 'Monitor', aka: 'runtime monitor', definition: 'A small program that reads the steps of a run and reports whether a property is violated (here: invariants and past-time properties in the generated code; any LTL property with NuRV).' },
    { term: 'Monitoring under assumptions', definition: 'Runtime verification that also uses the model of the system (NuRV): a verdict can be given as soon as every continuation the model allows decides the property, earlier than from the run alone.' },
    { term: 'Three-valued verdict', aka: 'true / false / unknown', definition: 'The answer of an LTL monitor on a finite run: true or false once the run decides the property, unknown while both are still possible.' },
    { term: 'Trace conformance', aka: 'conformance checking', definition: 'Checking that a recorded run of the real system is a run of the model: every step follows an enabled transition and the monitored properties hold.' },
    { term: 'Property-based testing', aka: 'Hypothesis, stateful testing', definition: 'Testing with generated inputs: here, random sequences of allowed events drive the implementation and each step is checked against the verified model.' },
    { term: 'Enumeration type', aka: 'symbolic constants, { a, b }', definition: 'An attribute that takes one of a finite set of named values.', example: 'status : { ready, busy };' },
    { term: 'Range type', aka: 'bounded integer, lo..hi', definition: 'An integer attribute restricted to an interval. Model checking needs finite domains, so counters must be bounded.', example: 'loop_count : 0..3;' }
];

export const REFERENCES: Reference[] = [
    { title: 'List of logic symbols', url: 'https://en.wikipedia.org/wiki/List_of_logic_symbols', note: 'Nomenclature of symbols used in mathematical logic, with names and Unicode.' },
    { title: 'Glossary of logic', url: 'https://en.wikipedia.org/wiki/Glossary_of_logic', note: 'Definitions of general logic terms.' },
    { title: 'Propositional calculus', url: 'https://en.wikipedia.org/wiki/Propositional_calculus', note: 'Connectives, truth tables and inference.' },
    { title: 'Linear temporal logic', url: 'https://en.wikipedia.org/wiki/Linear_temporal_logic', note: 'Syntax, semantics and equivalences of LTL.' },
    { title: 'Computation tree logic', url: 'https://en.wikipedia.org/wiki/Computation_tree_logic', note: 'Syntax, semantics and equivalences of CTL.' },
    { title: 'Kripke structure (model checking)', url: 'https://en.wikipedia.org/wiki/Kripke_structure_(model_checking)', note: 'The formal model behind the diagrams.' },
    { title: 'Model checking', url: 'https://en.wikipedia.org/wiki/Model_checking', note: 'Overview of techniques and tools.' },
    { title: 'Temporal Logic — Stanford Encyclopedia of Philosophy', url: 'https://plato.stanford.edu/entries/logic-temporal/', note: 'In-depth treatment of temporal logics.' },
    { title: 'Modal Logic — Stanford Encyclopedia of Philosophy', url: 'https://plato.stanford.edu/entries/logic-modal/', note: 'Possible worlds and the □ / ◇ operators.' },
    { title: 'nuXmv user manual (PDF)', url: 'https://nuxmv.fbk.eu/downloads/nuxmv-user-manual.pdf', note: 'nuXmv commands and extensions.' },
    { title: 'NuSMV 2.7 user manual (PDF)', url: 'https://nusmv.fbk.eu/userman/v27/nusmv.pdf', note: 'Complete input language: expressions, LTL/CTL/PSL syntax and operator precedence.' },
    { title: 'nuXmv documentation', url: 'https://nuxmv.fbk.eu/documentation.html', note: 'Manuals, tutorials and papers.' }
];
