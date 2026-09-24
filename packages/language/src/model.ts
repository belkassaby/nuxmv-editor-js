/**
 * Plain, serialisable description of a state transition diagram.
 *
 * This is the single source of truth shared by the text editor (Langium),
 * the graph editor (Cytoscape) and the nuXmv generator. It corresponds to the
 * data structure of the original JungToNusmv tool (stateIDList,
 * attribNameList, attribValuesList, graphTransition, stateAttribValue), but
 * keyed by name rather than by array index.
 */

export type AttributeType =
    | { kind: 'boolean' }
    | { kind: 'enum'; values: string[] }
    | { kind: 'range'; low: number; high: number };

export interface AttributeDef {
    name: string;
    type: AttributeType;
}

export interface Position {
    x: number;
    y: number;
}

export interface StateDef {
    /** Identifier used in the nuXmv model (value of the `state` variable). */
    name: string;
    /** Optional human readable label shown on the diagram. */
    label?: string;
    initial: boolean;
    /** attribute name -> value (`TRUE`/`FALSE`, an integer or an enum symbol). */
    values: Record<string, string>;
    position?: Position;
}

export interface TransitionDef {
    source: string;
    target: string;
    label?: string;
}

export type SpecKind = 'LTLSPEC' | 'CTLSPEC' | 'INVARSPEC';
export type FairnessKind = 'FAIRNESS' | 'JUSTICE';

export interface SpecDef {
    kind: SpecKind;
    name?: string;
    expression: string;
}

export interface FairnessDef {
    kind: FairnessKind;
    expression: string;
}

export interface DiagramModel {
    name?: string;
    attributes: AttributeDef[];
    states: StateDef[];
    transitions: TransitionDef[];
    fairness: FairnessDef[];
    specs: SpecDef[];
}

export function emptyDiagram(name = 'main'): DiagramModel {
    return { name, attributes: [], states: [], transitions: [], fairness: [], specs: [] };
}

/** All values an attribute can take, in nuXmv syntax. */
export function attributeDomain(type: AttributeType): string[] {
    switch (type.kind) {
        case 'boolean':
            return ['TRUE', 'FALSE'];
        case 'enum':
            return [...type.values];
        case 'range': {
            const values: string[] = [];
            for (let i = type.low; i <= type.high; i++) values.push(String(i));
            return values;
        }
    }
}

export function attributeTypeToString(type: AttributeType): string {
    switch (type.kind) {
        case 'boolean':
            return 'boolean';
        case 'enum':
            return `{ ${type.values.join(', ')} }`;
        case 'range':
            return `${type.low}..${type.high}`;
    }
}

/** Returns the next free state name of the form `s<n>`. */
export function nextStateName(model: DiagramModel, prefix = 's'): string {
    const used = new Set(model.states.map(s => s.name));
    let i = 0;
    while (used.has(`${prefix}${i}`)) i++;
    return `${prefix}${i}`;
}

/** States without any outgoing transition. */
export function deadEndStates(model: DiagramModel): string[] {
    const withSuccessor = new Set(model.transitions.map(t => t.source));
    return model.states.filter(s => !withSuccessor.has(s.name)).map(s => s.name);
}

export function successors(model: DiagramModel, state: string): string[] {
    const result: string[] = [];
    for (const t of model.transitions) {
        if (t.source === state && !result.includes(t.target)) result.push(t.target);
    }
    return result;
}
