import { emptyDiagram, type DiagramModel } from './model.js';
import { NUXMV_RESERVED } from './state-diagram-validator.js';

export type ImportFormat = 'mermaid' | 'langgraph-json' | 'xstate' | 'langgraph-python' | 'crewai-python';

export interface ImportResult {
    model: DiagramModel;
    format: ImportFormat;
    /** Things that could not be represented, or were guessed. */
    notes: string[];
}

interface Graph {
    name?: string;
    nodes: Map<string, string | undefined>; // id -> label
    edges: Array<{ source: string; target: string; label?: string }>;
    initial: string[];
    final: string[];
    notes: string[];
}

const START = new Set(['__start__', '[*]', 'START']);
const END = new Set(['__end__', 'END']);

/**
 * Imports an existing agent or workflow graph as a diagram: Mermaid
 * (flowchart as produced by LangGraph's draw_mermaid(), or stateDiagram),
 * LangGraph's get_graph().to_json(), an XState machine config, or — best
 * effort, by reading the calls — LangGraph or CrewAI Flow Python source.
 * The format is detected from the text.
 */
export function importGraph(text: string, format?: ImportFormat): ImportResult {
    const detected = format ?? detectFormat(text);
    let graph: Graph;
    switch (detected) {
        case 'mermaid':
            graph = fromMermaid(text);
            break;
        case 'langgraph-json':
            graph = fromLangGraphJson(JSON.parse(text));
            break;
        case 'xstate':
            graph = fromXState(parseLooseJson(text));
            break;
        case 'langgraph-python':
            graph = fromLangGraphPython(text);
            break;
        case 'crewai-python':
            graph = fromCrewAIPython(text);
            break;
    }
    return { model: toModel(graph), format: detected, notes: graph.notes };
}

export function detectFormat(text: string): ImportFormat {
    const t = text.trim();
    if (t.startsWith('{') || t.startsWith('[') || /createMachine\s*\(/.test(t)) {
        if (/"nodes"\s*:/.test(t) && /"edges"\s*:/.test(t)) return 'langgraph-json';
        return 'xstate';
    }
    if (/^(---[\s\S]*?---\s*)?(graph|flowchart|stateDiagram(-v2)?)\b/m.test(t)) return 'mermaid';
    if (/StateGraph\s*\(|add_conditional_edges|add_edge\s*\(/.test(t)) return 'langgraph-python';
    if (/@start\s*\(|@listen\s*\(|@router\s*\(/.test(t)) return 'crewai-python';
    throw new Error('Unrecognised format: expected Mermaid, LangGraph JSON, an XState machine, or LangGraph / CrewAI Flow Python source.');
}

// ---------------------------------------------------------------------------

function newGraph(): Graph {
    return { nodes: new Map(), edges: [], initial: [], final: [], notes: [] };
}

function addEdge(g: Graph, source: string, rawTarget: string, label?: string): void {
    // END, __end__ ... are one end node.
    const target = END.has(rawTarget) ? '__end__' : rawTarget;
    const clean = label?.replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim();
    if (START.has(source)) {
        if (!END.has(target) && !g.initial.includes(target)) g.initial.push(target);
        if (!g.nodes.has(target)) g.nodes.set(target, undefined);
        return;
    }
    for (const id of [source, target]) if (!g.nodes.has(id) && !START.has(id)) g.nodes.set(id, undefined);
    g.edges.push({ source, target, ...(clean ? { label: clean } : {}) });
}

function fromMermaid(text: string): Graph {
    const g = newGraph();
    const body = text.replace(/^---[\s\S]*?---\s*/m, '');
    const isState = /^\s*stateDiagram/m.test(body);
    const node = String.raw`([A-Za-z0-9_\[\]*.-]+|\[\*\])(?:\s*(?:\(\[|\[\[|\(\(|\[\(|\(|\[|\{|>)([^)\]}]*)(?:\]\)|\]\]|\)\)|\)\]|\)|\]|\}))?`;
    const arrow = String.raw`\s*(?:-\.\s*([^.]*?)\s*\.->|--\s*([^-|>]+?)\s*-->|==>|-->|-\.->|--x|--o)\s*(?:\|([^|]*)\|)?\s*`;
    for (const raw of body.split(/\r?\n/)) {
        const line = raw.replace(/%%.*$/, '').trim().replace(/;$/, '');
        if (!line || /^(graph|flowchart|stateDiagram|classDef|class|style|linkStyle|direction|note|end\b|subgraph)/.test(line)) continue;
        if (isState) {
            const alias = /^state\s+"([^"]+)"\s+as\s+(\w+)/.exec(line);
            if (alias) {
                g.nodes.set(alias[2], alias[1]);
                continue;
            }
            const m = /^(\[\*\]|[\w.-]+)\s*-->\s*(\[\*\]|[\w.-]+)\s*(?::\s*(.+))?$/.exec(line);
            if (m) {
                if (m[2] === '[*]') g.final.push(m[1]);
                else addEdge(g, m[1], m[2], m[3]);
                if (m[1] !== '[*]' && !g.nodes.has(m[1])) g.nodes.set(m[1], undefined);
                continue;
            }
            const decl = /^([\w.-]+)\s*:\s*(.+)$/.exec(line);
            if (decl) g.nodes.set(decl[1], decl[2]);
            continue;
        }
        // Flowchart: a chain of nodes separated by arrows, each node optionally with a shape and label.
        const re = new RegExp(`^${node}((?:${arrow}${node})+)$`);
        const chain = re.exec(line);
        if (chain) {
            const parts: Array<{ id: string; label?: string }> = [{ id: chain[1], label: chain[2] }];
            const labels: Array<string | undefined> = [];
            const step = new RegExp(`${arrow}${node}`, 'g');
            for (const m of chain[3].matchAll(step)) {
                labels.push(m[1] ?? m[2] ?? m[3]);
                parts.push({ id: m[4], label: m[5] });
            }
            parts.forEach(p => p.label && !START.has(p.id) && g.nodes.set(p.id, p.label.trim()));
            for (let i = 1; i < parts.length; i++) addEdge(g, parts[i - 1].id, parts[i].id, labels[i - 1]);
            continue;
        }
        const single = new RegExp(`^${node}$`).exec(line);
        if (single) {
            if (!START.has(single[1]) && !END.has(single[1])) g.nodes.set(single[1], single[2]?.trim() || g.nodes.get(single[1]));
            continue;
        }
        g.notes.push(`Ignored line: ${line}`);
    }
    return g;
}

function fromLangGraphJson(json: { nodes?: Array<{ id: string; data?: { name?: string } }>; edges?: Array<{ source: string; target: string; data?: unknown; conditional?: boolean }> }): Graph {
    const g = newGraph();
    for (const n of json.nodes ?? []) if (!START.has(n.id)) g.nodes.set(n.id, undefined);
    for (const e of json.edges ?? []) addEdge(g, e.source, e.target, typeof e.data === 'string' ? e.data : undefined);
    if ((json.edges ?? []).some(e => e.conditional)) g.notes.push('Conditional edges became nondeterministic choices: nuXmv checks every branch the router could take.');
    return g;
}

interface XStateNode {
    initial?: string;
    type?: string;
    on?: Record<string, unknown>;
    always?: unknown;
    after?: Record<string, unknown>;
    states?: Record<string, XStateNode>;
}

function fromXState(config: XStateNode & { id?: string }): Graph {
    const g = newGraph();
    g.name = config.id;
    const targetsOf = (t: unknown): Array<{ target: string; guard?: string }> => {
        if (typeof t === 'string') return [{ target: t }];
        if (Array.isArray(t)) return t.flatMap(targetsOf);
        if (t && typeof t === 'object') {
            const o = t as { target?: string | string[]; guard?: unknown; cond?: unknown };
            const guard = typeof o.guard === 'string' ? o.guard : typeof o.cond === 'string' ? o.cond : undefined;
            const targets = Array.isArray(o.target) ? o.target : o.target ? [o.target] : [];
            return targets.map(target => ({ target, ...(guard ? { guard } : {}) }));
        }
        return [];
    };
    const walk = (states: Record<string, XStateNode>, prefix: string) => {
        for (const [name, node] of Object.entries(states)) {
            const id = prefix + name;
            if (node.states && Object.keys(node.states).length > 0) {
                g.notes.push(`Compound state '${id}' was flattened; its children are named ${id}_<child>.`);
                walk(node.states, `${id}_`);
                if (node.initial) g.nodes.set(id, undefined);
            } else {
                g.nodes.set(id, undefined);
            }
            if (node.type === 'final') g.final.push(id);
            for (const [event, t] of Object.entries(node.on ?? {})) {
                for (const { target, guard } of targetsOf(t)) {
                    const resolved = target.replace(/^\./, prefix).replace(/^#[^.]+\./, '').replace(/\./g, '_');
                    addEdge(g, id, resolved, guard ? `${event} [${guard}]` : event);
                    if (guard) g.notes.push(`Guard '${guard}' on ${id} --${event}-> ${resolved} is kept as a label only: add it as a 'when' condition over variables.`);
                }
            }
            if (node.always || node.after) g.notes.push(`Eventless/delayed transitions of '${id}' were not imported.`);
        }
    };
    walk(config.states ?? {}, '');
    if (config.initial) g.initial.push(config.initial);
    return g;
}

function fromLangGraphPython(text: string): Graph {
    const g = newGraph();
    for (const m of text.matchAll(/\.add_node\(\s*["']([\w-]+)["']/g)) g.nodes.set(m[1], undefined);
    const id = (s: string) => s.trim().replace(/^["']|["']$/g, '');
    for (const m of text.matchAll(/\.add_edge\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/g)) addEdge(g, id(m[1]), id(m[2]));
    for (const m of text.matchAll(/\.add_conditional_edges\(\s*([^,]+?)\s*,\s*[\w.]+\s*(?:,\s*(\{[^}]*\}|\[[^\]]*\]))?\s*\)/g)) {
        const source = id(m[1]);
        const map = m[2] ?? '';
        if (map.startsWith('{')) {
            for (const e of map.matchAll(/["']([^"']+)["']\s*:\s*([\w"']+)/g)) addEdge(g, source, id(e[2]), e[1]);
        } else if (map.startsWith('[')) {
            for (const e of map.matchAll(/([\w"']+)/g)) addEdge(g, source, id(e[1]));
        } else {
            g.notes.push(`The router of add_conditional_edges('${source}', ...) has no path map: its targets could not be read. Add the transitions by hand.`);
        }
    }
    for (const m of text.matchAll(/\.set_entry_point\(\s*["']([\w-]+)["']/g)) g.initial.push(m[1]);
    for (const m of text.matchAll(/\.set_finish_point\(\s*["']([\w-]+)["']/g)) g.final.push(m[1]);
    g.notes.push('Read from Python source by pattern matching: check the result against the code.');
    return g;
}

function fromCrewAIPython(text: string): Graph {
    const g = newGraph();
    const methods: Array<{ name: string; decorators: string[]; body: string }> = [];
    const re = /((?:\s*@[\w.]+\([^)]*\)\s*)+)\s*(?:async\s+)?def\s+(\w+)\s*\([^)]*\)[^:]*:([\s\S]*?)(?=\n\s*(?:@|def |class |$))/g;
    for (const m of text.matchAll(re)) methods.push({ name: m[2], decorators: [...m[1].matchAll(/@([\w.]+)\(([^)]*)\)/g)].map(d => `${d[1]}(${d[2]})`), body: m[3] });
    const listeners = new Map<string, string[]>(); // trigger (method or router label) -> listener methods
    for (const m of methods) {
        g.nodes.set(m.name, undefined);
        for (const d of m.decorators) {
            if (/^start\(/.test(d)) g.initial.push(m.name);
            const listen = /^listen\((.+)\)$/.exec(d);
            if (listen) {
                for (const trigger of listen[1].split(/,|or_\(|and_\(|\)/).map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean)) {
                    listeners.set(trigger, [...(listeners.get(trigger) ?? []), m.name]);
                }
            }
        }
    }
    for (const m of methods) {
        for (const target of listeners.get(m.name) ?? []) if (!m.decorators.some(d => d.startsWith('router('))) addEdge(g, m.name, target);
        if (m.decorators.some(d => d.startsWith('router('))) {
            // A router's return values are the labels its listeners wait for.
            for (const r of m.body.matchAll(/return\s+["']([\w-]+)["']/g)) for (const target of listeners.get(r[1]) ?? []) addEdge(g, m.name, target, r[1]);
            const trigger = /^router\((.+)\)$/.exec(m.decorators.find(d => d.startsWith('router('))!)![1].trim();
            addEdge(g, trigger.replace(/^["']|["']$/g, ''), m.name);
        }
    }
    g.notes.push('Read from CrewAI Flow source (@start / @listen / @router) by pattern matching: check the result against the code.');
    return g;
}

// ---------------------------------------------------------------------------

function toModel(g: Graph): DiagramModel {
    const model = emptyDiagram(identifier(g.name ?? 'Imported', new Set()));
    const used = new Set<string>();
    const names = new Map<string, string>();
    const hasEnd = g.edges.some(e => END.has(e.target)) || g.final.length > 0;
    const nameOf = (id: string) => {
        if (!names.has(id)) names.set(id, identifier(END.has(id) ? 'finished' : id, used));
        return names.get(id)!;
    };
    for (const [id, label] of g.nodes) {
        if (END.has(id)) continue;
        const name = nameOf(id);
        const shown = label && label !== id ? label : name !== id ? id : undefined;
        model.states.push({ name, initial: false, values: {}, ...(shown ? { label: shown } : {}) });
    }
    if (g.edges.some(e => END.has(e.target))) model.states.push({ name: nameOf('__end__'), label: 'end', initial: false, values: {} });
    for (const e of g.edges) {
        if (!g.nodes.has(e.source) && !END.has(e.source)) continue;
        model.transitions.push({ source: nameOf(e.source), target: nameOf(e.target), ...(e.label ? { label: e.label } : {}) });
    }
    const initial = g.initial.length > 0 ? g.initial : model.states.slice(0, 1).map(s => s.name);
    for (const s of model.states) if (initial.map(nameOf).includes(s.name)) s.initial = true;
    // Final states: explicit ones and the end node stutter, as in the nuXmv semantics.
    const finals = new Set([...g.final.map(nameOf), ...(hasEnd && g.edges.some(e => END.has(e.target)) ? [nameOf('__end__')] : [])]);
    for (const f of finals) if (!model.transitions.some(t => t.source === f)) model.transitions.push({ source: f, target: f });
    return model;
}

/** Turns any name into a nuXmv identifier that is unique in `used` (which it extends). */
export function nuxmvIdentifier(raw: string, used: Set<string>): string {
    return identifier(raw, used);
}

function identifier(raw: string, used: Set<string>): string {
    let s = raw.replace(/[^\w$#]+/g, '_').replace(/^_+|_+$/g, '') || 'state';
    if (/^[0-9]/.test(s)) s = `s_${s}`;
    if (NUXMV_RESERVED.has(s) || KEYWORDS.has(s)) s = `${s}_`;
    let unique = s;
    for (let i = 2; used.has(unique); i++) unique = `${s}_${i}`;
    used.add(unique);
    return unique;
}

const KEYWORDS = new Set(['diagram', 'attributes', 'variables', 'state', 'initial', 'at', 'boolean', 'when', 'do', 'prob', 'mod', 'xor', 'xnor', 'TRUE', 'FALSE', 'LTLSPEC', 'CTLSPEC', 'INVARSPEC', 'FAIRNESS', 'JUSTICE', 'NAME']);

/** JSON, or a JS object literal (e.g. pasted from createMachine({...})). */
function parseLooseJson(text: string): XStateNode & { id?: string } {
    const body = text.replace(/^[\s\S]*?createMachine\s*\(/, '').replace(/\)\s*;?\s*$/, '');
    try {
        return JSON.parse(body);
    } catch {
        const json = body
            .replace(/\/\/[^\n]*/g, '')
            .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
            .replace(/'([^'\\]*)'/g, '"$1"')
            .replace(/,(\s*[}\]])/g, '$1');
        return JSON.parse(json);
    }
}
