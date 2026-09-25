import type { AttributeType as AstAttributeType, AttributeValue, Diagram, Expression } from './generated/ast.js';
import type { AttributeType, DiagramModel, StateDef, TransitionDef } from './model.js';
import { diagramAttributes, diagramStates, diagramVariables } from './state-diagram-validator.js';

/** Converts a parsed `.pflow` document into the plain {@link DiagramModel}. */
export function astToModel(diagram: Diagram): DiagramModel {
    const model: DiagramModel = {
        name: diagram.name,
        attributes: diagramAttributes(diagram).map(a => ({ name: a.name, type: convertType(a.type) })),
        variables: diagramVariables(diagram).map(v => ({ name: v.name, type: convertType(v.type), initial: valueToString(v.initial) })),
        states: [],
        transitions: [],
        fairness: [],
        specs: []
    };

    for (const state of diagramStates(diagram)) {
        const values: Record<string, string> = {};
        for (const assignment of state.assignments) {
            const name = assignment.attribute.ref?.name ?? assignment.attribute.$refText;
            values[name] = valueToString(assignment.value);
        }
        const def: StateDef = { name: state.name, initial: state.initial, values };
        if (state.label !== undefined) def.label = state.label;
        if (state.x !== undefined && state.y !== undefined) def.position = { x: state.x, y: state.y };
        model.states.push(def);
    }

    for (const element of diagram.elements) {
        switch (element.$type) {
            case 'Transition': {
                const source = element.source.ref?.name ?? element.source.$refText;
                const target = element.target.ref?.name ?? element.target.$refText;
                const t: TransitionDef = { source, target };
                if (element.label !== undefined) t.label = element.label;
                if (element.guard) t.guard = expressionText(element.guard);
                if (element.updates.length > 0) {
                    t.updates = element.updates.map(u => ({ variable: u.variable.ref?.name ?? u.variable.$refText, expression: expressionText(u.value) }));
                }
                if (element.probability !== undefined) t.probability = element.probability;
                model.transitions.push(t);
                break;
            }
            case 'Fairness':
                model.fairness.push({ kind: element.kind, expression: expressionText(element.expression) });
                break;
            case 'Specification':
                model.specs.push({
                    kind: element.kind,
                    ...(element.name ? { name: element.name } : {}),
                    expression: expressionText(element.expression)
                });
                break;
        }
    }
    return model;
}

function convertType(type: AstAttributeType): AttributeType {
    switch (type.$type) {
        case 'BooleanType':
            return { kind: 'boolean' };
        case 'EnumType':
            return { kind: 'enum', values: type.values.map(v => v.name) };
        case 'RangeType':
            return { kind: 'range', low: type.low, high: type.high };
    }
}

function valueToString(value: AttributeValue): string {
    switch (value.$type) {
        case 'BooleanValue':
            return value.value;
        case 'IntegerValue':
            return String(value.value);
        case 'SymbolValue':
            return value.symbol;
    }
}

/** The expression exactly as typed (whitespace normalised), so nuXmv sees what the user wrote. */
export function expressionText(expression: Expression): string {
    return (expression.$cstNode?.text ?? '')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(\/\/|--)[^\n\r]*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
