export interface Example {
    id: string;
    title: string;
    group: 'Classic models' | 'Agentic AI patterns';
    description: string;
    source: string;
    /** Verdict nuXmv returns for each specification, in declaration order (checked by the tests). */
    expected: Array<'true' | 'false'>;
}


export const EXAMPLES: Example[] = [
    {
        id: 'resource-monitor',
        group: 'Classic models',
        expected: ['false', 'true'],
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
        group: 'Classic models',
        expected: ['true', 'true'],
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
        group: 'Classic models',
        expected: ['true', 'false', 'true', 'true'],
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
        group: 'Classic models',
        expected: ['true'],
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
    },
    // -------------------------------------------------------------------------
    // Agentic AI patterns modelled after the XState machines of
    // https://github.com/adamterlson/AgenticStateMachines. The LLM's choices
    // (call a tool or answer, approve or deny, which agent to run next) become
    // nondeterministic transitions, so nuXmv explores every possible decision.
    // -------------------------------------------------------------------------
    {
        id: 'agent-writer-tools',
        title: 'Writer with tool use',
        group: 'Agentic AI patterns',
        description: 'An LLM writer that may call an inventory tool before answering. Liveness fails: nothing stops the model from calling the tool forever.',
        expected: ['true', 'true', 'false', 'true'],
        source: `// Writer w/ tool use (after adamterlson/AgenticStateMachines, writer.ts)
// The LLM either requests a tool call or answers; tool results go back to it.
diagram WriterToolUse

attributes {
  llm_busy    : boolean;
  tool_active : boolean;
  finished    : boolean;
}

initial state writing "LLM writing" { llm_busy = TRUE, tool_active = FALSE, finished = FALSE } at (120, 180)
state using_tool "get_inventory" { llm_busy = FALSE, tool_active = TRUE, finished = FALSE } at (400, 80)
state done "final" { llm_busy = FALSE, tool_active = FALSE, finished = TRUE } at (400, 290)

writing -> using_tool : "tool_calls != null";
writing -> done : "answer";
using_tool -> writing : "add_tool_response";
done -> done;

INVARSPEC NAME tool_xor_finished := !(tool_active & finished);
LTLSPEC NAME results_return := G (tool_active -> X llm_busy);
LTLSPEC NAME always_answers := F finished;
CTLSPEC NAME can_always_finish := AG (!finished -> EF finished);
`
    },
    {
        id: 'agent-reflection',
        title: 'Reflection (bounded)',
        group: 'Agentic AI patterns',
        description: 'Writer and critic agents exchange feedback. The loop counter (maxLoopCount = 1) is unrolled into the states, so termination can be proved.',
        expected: ['true', 'true', 'true', 'true'],
        source: `// Reflection (after adamterlson/AgenticStateMachines, reflection.ts)
// critiquing -> writing only while loopCount < maxLoopCount (= 1), else done.
diagram Reflection

attributes {
  phase : { writer, critic, finished };
  loop  : 0..1;
}

initial state writing0 "write draft" { phase = writer, loop = 0 } at (80, 80)
state critiquing0 "critique draft" { phase = critic, loop = 0 } at (320, 80)
state writing1 "rewrite" { phase = writer, loop = 1 } at (320, 260)
state critiquing1 "critique rewrite" { phase = critic, loop = 1 } at (80, 260)
state done "final" { phase = finished, loop = 1 } at (80, 420)

writing0 -> critiquing0 : "writerAgent done";
critiquing0 -> writing1 : "loopCount < max";
writing1 -> critiquing1 : "writerAgent done";
critiquing1 -> done : "loopCount = max";
done -> done;

LTLSPEC NAME terminates := F phase = finished;
INVARSPEC NAME bounded := loop <= 1;
CTLSPEC NAME last_critique_ends := AG (phase = critic & loop = 1 -> AX phase = finished);
LTLSPEC NAME critic_follows_writer := G (phase = writer -> X phase = critic);
`
    },
    {
        id: 'agent-reflection-loop',
        title: 'Reflection loop with retry budget',
        group: 'Agentic AI patterns',
        description: 'Draft, critique and refine with at most two refinements. It always terminates, but not always with an approval: nuXmv shows the path to "max retries".',
        expected: ['true', 'false', 'true', 'true', 'true'],
        source: `// Reflection & critique loop with a retry budget of 2 refinements.
// The evaluator's verdict (pass / fail) is left to nuXmv: both are explored.
diagram AgentReflectionLoop

attributes {
  phase      : { drafting, critiquing, refining, approved, failed };
  loop_count : 0..3;   // the domain allows 3; the invariant proves no 3rd refinement
}

initial state drafting "draft" { phase = drafting, loop_count = 0 } at (80, 60)
state critique0 "critique #1" { phase = critiquing, loop_count = 0 } at (300, 60)
state refine1 "refine #1" { phase = refining, loop_count = 1 } at (520, 60)
state critique1 "critique #2" { phase = critiquing, loop_count = 1 } at (520, 220)
state refine2 "refine #2" { phase = refining, loop_count = 2 } at (300, 220)
state critique2 "critique #3" { phase = critiquing, loop_count = 2 } at (80, 220)
state approved "approved" { phase = approved } at (300, 380)
state failed "max retries" { phase = failed, loop_count = 2 } at (80, 380)

drafting -> critique0;
critique0 -> approved : "passes_eval";
critique0 -> refine1 : "fails_eval";
refine1 -> critique1;
critique1 -> approved : "passes_eval";
critique1 -> refine2 : "fails_eval";
refine2 -> critique2;
critique2 -> approved : "passes_eval";
critique2 -> failed : "fails_eval";
approved -> approved;
failed -> failed;

LTLSPEC NAME terminates := F (phase = approved | phase = failed);
LTLSPEC NAME always_approved := F phase = approved;
INVARSPEC NAME retry_budget := phase = refining -> loop_count <= 2;
CTLSPEC NAME approval_possible := AG (phase = critiquing -> EX phase = approved);
CTLSPEC NAME no_dead_ends := AG EX TRUE;
`
    },
    {
        id: 'agent-tool-approval',
        title: 'Human-in-the-loop tool approval',
        group: 'Agentic AI patterns',
        description: 'A human must approve every tool call. Safety holds (no tool use without approval), but repeated denials can keep the agent from finishing.',
        expected: ['true', 'true', 'true', 'false'],
        source: `// Tool approval (after adamterlson/AgenticStateMachines, human_in_the_loop.ts)
diagram ToolApproval

attributes {
  awaiting_human : boolean;
  tool_active    : boolean;
  finished       : boolean;
}

initial state writing "LLM writing" { awaiting_human = FALSE, tool_active = FALSE, finished = FALSE } at (100, 200)
state approval_required "wait for admin" { awaiting_human = TRUE, tool_active = FALSE, finished = FALSE } at (360, 80)
state using_tool "get_inventory" { awaiting_human = FALSE, tool_active = TRUE, finished = FALSE } at (560, 200)
state done "final" { awaiting_human = FALSE, tool_active = FALSE, finished = TRUE } at (360, 330)

writing -> approval_required : "tool call";
writing -> done : "answer";
approval_required -> using_tool : "approve";
approval_required -> writing : "deny";
using_tool -> writing : "tool response";
done -> done;

CTLSPEC NAME no_tool_without_approval := AG (!awaiting_human -> AX !tool_active);
LTLSPEC NAME human_is_consulted := G (X tool_active -> awaiting_human);
LTLSPEC NAME approval_is_answered := G (awaiting_human -> X !awaiting_human);
LTLSPEC NAME always_finishes := F finished;
`
    },
    {
        id: 'agent-orchestration',
        title: 'Orchestration (LLM router)',
        group: 'Agentic AI patterns',
        description: 'A planning LLM routes to specialist agents (meal delivery). Nothing forces the intended order: nuXmv shows the meal can be prepared before any recipe exists.',
        expected: ['true', 'false', 'false', 'true'],
        source: `// Orchestration / routing (after adamterlson/AgenticStateMachines, collaboration.ts)
// The planner picks any tool; every specialist reports back to the planner.
diagram Orchestration

attributes {
  agent : { planner, recipe, procurement, meal_prep, feedback, summarizer, none };
}

initial state planning "Planning" { agent = planner } at (320, 240)
state writing_recipe "Writing Recipe" { agent = recipe } at (120, 80)
state procuring "Procuring Ingredients" { agent = procurement } at (520, 80)
state preparing_meal "Preparing Meal" { agent = meal_prep } at (560, 300)
state getting_feedback "Getting Feedback" { agent = feedback } at (320, 440)
state summarizing "Summarizing Result" { agent = summarizer } at (80, 320)
state done "Done" { agent = none } at (80, 460)

planning -> writing_recipe : "recipeAgent";
planning -> procuring : "procurementAgent";
planning -> preparing_meal : "mealPrepAgent";
planning -> getting_feedback : "humanFeedbackAgent";
planning -> summarizing : "done";
writing_recipe -> planning;
procuring -> planning;
preparing_meal -> planning;
getting_feedback -> planning;
summarizing -> done;
done -> done;

CTLSPEC NAME can_deliver := AG EF agent = none;
LTLSPEC NAME recipe_before_cooking := !(agent = meal_prep) U agent = recipe;
LTLSPEC NAME eventually_done := F agent = none;
CTLSPEC NAME planner_is_hub := AG (agent = recipe | agent = procurement | agent = meal_prep | agent = feedback -> AX agent = planner);
`
    },
    {
        id: 'agent-collaboration',
        title: 'Collaboration (fixed pipeline)',
        group: 'Agentic AI patterns',
        description: 'The same specialists wired as a defined sequence of steps. The ordering and termination properties that failed for the LLM router now hold.',
        expected: ['true', 'true', 'true', 'true'],
        source: `// Collaboration as a defined sequence of specialist agents
diagram Collaboration

attributes {
  agent : { recipe, procurement, meal_prep, feedback, summarizer, none };
}

initial state writing_recipe "Writing Recipe" { agent = recipe } at (80, 100)
state procuring "Procuring Ingredients" { agent = procurement } at (300, 100)
state preparing_meal "Preparing Meal" { agent = meal_prep } at (520, 100)
state getting_feedback "Getting Feedback" { agent = feedback } at (520, 280)
state summarizing "Summarizing Result" { agent = summarizer } at (300, 280)
state done "Done" { agent = none } at (80, 280)

writing_recipe -> procuring;
procuring -> preparing_meal;
preparing_meal -> getting_feedback;
getting_feedback -> summarizing;
summarizing -> done;
done -> done;

LTLSPEC NAME recipe_before_cooking := !(agent = meal_prep) U agent = recipe;
LTLSPEC NAME ingredients_before_cooking := !(agent = meal_prep) U agent = procurement;
LTLSPEC NAME eventually_done := F agent = none;
CTLSPEC NAME feedback_after_meal := AG (agent = meal_prep -> AX agent = feedback);
`
    },
    {
        id: 'agent-chat',
        title: 'Chat agent',
        group: 'Agentic AI patterns',
        description: 'A conversational recipe agent with tool approval (writer_chat.ts). Model checking shows its final state can never be reached: it is dead code.',
        expected: ['true', 'false', 'true', 'true'],
        source: `// Chat with recipe agent (after adamterlson/AgenticStateMachines, writer_chat.ts)
// Note: no transition of the original machine targets 'done'.
diagram ChatAgent

attributes {
  turn : { user, assistant, admin, tool, closed };
}

initial state idle "waiting for user" { turn = user } at (100, 200)
state writing "LLM writing" { turn = assistant } at (340, 200)
state approval_required "wait for admin" { turn = admin } at (560, 80)
state using_tool "get_inventory" { turn = tool } at (560, 320)
state done "final (unreachable)" { turn = closed } at (100, 400)

idle -> writing : "USER_MESSAGE";
writing -> idle : "reply";
writing -> approval_required : "tool call";
approval_required -> using_tool : "approve";
approval_required -> writing : "deny";
using_tool -> writing : "tool response";
done -> done;

CTLSPEC NAME can_always_reply := AG EF turn = user;
CTLSPEC NAME final_state_reachable := EF turn = closed;
INVARSPEC NAME never_closed := turn != closed;
CTLSPEC NAME tool_needs_admin := AG (turn != admin -> AX turn != tool);
`
    },
    {
        id: 'agent-generation',
        title: 'Agent generation with testing',
        group: 'Agentic AI patterns',
        description: 'An agent that designs another state machine, with the test-and-retry loop of agent_generation.ts. Steps stay in order, but failing tests can retry forever.',
        expected: ['true', 'true', 'false', 'true'],
        source: `// Agent generation (after adamterlson/AgenticStateMachines, agent_generation.ts,
// including its commented-out "Testing Machine" retry loop)
diagram AgentGeneration

attributes {
  step : { events, context, actors, writing, testing, finished };
}

initial state event_storming "Event Storming" { step = events } at (80, 80)
state defining_context "Defining Context" { step = context } at (300, 80)
state connecting_actors "Connecting Actors" { step = actors } at (520, 80)
state writing_machine "Writing Machine" { step = writing } at (520, 260)
state testing_machine "Testing Machine" { step = testing } at (300, 260)
state done "Done" { step = finished } at (80, 260)

event_storming -> defining_context;
defining_context -> connecting_actors;
connecting_actors -> writing_machine;
writing_machine -> testing_machine;
testing_machine -> done : "onDone";
testing_machine -> writing_machine : "onError";
done -> done;

LTLSPEC NAME actors_before_code := !(step = writing) U step = actors;
CTLSPEC NAME can_finish := AG EF step = finished;
LTLSPEC NAME always_finishes := F step = finished;
LTLSPEC NAME tested_before_done := !(step = finished) U step = testing;
`
    }
];
