export interface Example {
    id: string;
    title: string;
    description: string;
    source: string;
}

export const EXAMPLES: Example[] = [
    {
        id: 'resource-monitor',
        title: 'Resource monitor',
        description: 'The "sequential style" resource monitor of the original dissertation (section 2.2.2), after [HR04].',
        source: `// Resource monitor (Huth & Ryan, Logic in Computer Science, ch. 3)
diagram ResourceMonitor

attributes {
  status  : { ready, busy };
  request : boolean;
}

initial state s0 { status = ready, request = TRUE } at (120, 100)
state s1 { status = busy, request = TRUE } at (380, 100)
state s2 { status = ready, request = FALSE } at (120, 320)
state s3 { status = busy, request = FALSE } at (380, 320)

s0 -> s1;
s0 -> s3;
s1 -> s1;
s1 -> s3;
s2 -> s0;
s2 -> s1;
s2 -> s2;
s2 -> s3;
s3 -> s0;
s3 -> s1;
s3 -> s2;
s3 -> s3;

LTLSPEC G (request -> F status = ready);
CTLSPEC AG EF status = ready;
`
    },
    {
        id: 'walkthrough',
        title: 'JungToNusmv walkthrough',
        description: 'The three-state p, q, r example from Appendix A of the dissertation.',
        source: `// Appendix A walkthrough: three boolean atoms p, q and r
diagram Walkthrough

attributes {
  p : boolean;
  q : boolean;
  r : boolean;
}

initial state s0 { p = TRUE, q = TRUE, r = FALSE } at (100, 200)
state s1 { p = FALSE, q = TRUE, r = TRUE } at (320, 90)
state s2 { p = FALSE, q = FALSE, r = TRUE } at (320, 310)

s0 -> s1;
s0 -> s2;
s1 -> s2;
s2 -> s0;

LTLSPEC G (p -> F r);
CTLSPEC AG (q -> EX r);
`
    },
    {
        id: 'mutex',
        title: 'Mutual exclusion',
        description: 'First attempt at modelling mutual exclusion ([HR04] fig. 3.7). Liveness fails: nuXmv returns a counterexample.',
        source: `// Two processes, each non-critical (n), trying (t) or critical (c)
diagram Mutex

attributes {
  p1 : { n, t, c };
  p2 : { n, t, c };
}

initial state s0 "n1 n2" { p1 = n, p2 = n } at (300, 40)
state s1 "t1 n2" { p1 = t, p2 = n } at (160, 150)
state s5 "n1 t2" { p1 = n, p2 = t } at (440, 150)
state s2 "c1 n2" { p1 = c, p2 = n } at (60, 280)
state s3 "t1 t2" { p1 = t, p2 = t } at (300, 280)
state s6 "n1 c2" { p1 = n, p2 = c } at (540, 280)
state s4 "c1 t2" { p1 = c, p2 = t } at (180, 420)
state s7 "t1 c2" { p1 = t, p2 = c } at (420, 420)

s0 -> s1;
s0 -> s5;
s1 -> s2;
s1 -> s3;
s5 -> s3;
s5 -> s6;
s2 -> s0;
s2 -> s4;
s3 -> s4;
s3 -> s7;
s6 -> s0;
s6 -> s7;
s4 -> s5;
s7 -> s1;

CTLSPEC NAME safety := AG !(p1 = c & p2 = c);
LTLSPEC NAME liveness := G (p1 = t -> F p1 = c);
CTLSPEC NAME non_blocking := AG (p1 = n -> EX p1 = t);
INVARSPEC NAME never_both_critical := !(p1 = c & p2 = c);
`
    },
    {
        id: 'microwave',
        title: 'Microwave oven',
        description: 'The microwave oven Kripke structure of Clarke, Grumberg & Peled (2000). The property only holds under the FAIRNESS constraint: delete it to get a counterexample.',
        source: `// Microwave oven (Clarke, Grumberg & Peled)
diagram Microwave

attributes {
  start : boolean;
  close : boolean;
  heat  : boolean;
  error : boolean;
}

initial state s1 "idle" { start = FALSE, close = FALSE, heat = FALSE, error = FALSE } at (80, 60)
state s2 "start oven" { start = TRUE, close = FALSE, heat = FALSE, error = TRUE } at (340, 60)
state s3 "close door" { start = FALSE, close = TRUE, heat = FALSE, error = FALSE } at (80, 260)
state s4 "cook" { start = FALSE, close = TRUE, heat = TRUE, error = FALSE } at (80, 460)
state s5 "close with error" { start = TRUE, close = TRUE, heat = FALSE, error = TRUE } at (340, 260)
state s6 "start" { start = TRUE, close = TRUE, heat = FALSE, error = FALSE } at (340, 460)
state s7 "warmup" { start = TRUE, close = TRUE, heat = TRUE, error = FALSE } at (580, 460)

s1 -> s2 : "start oven";
s1 -> s3 : "close door";
s2 -> s5 : "close door";
s3 -> s1 : "open door";
s3 -> s6 : "start oven";
s4 -> s1 : "open door";
s4 -> s3 : "done";
s4 -> s4 : "cook";
s5 -> s2 : "open door";
s5 -> s3 : "reset";
s6 -> s7 : "warmup";
s7 -> s4 : "start cooking";

CTLSPEC AG (start -> AF heat);
FAIRNESS start & close & !error;
`
    }
];
