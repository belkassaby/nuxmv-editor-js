import { AstUtils, type AstNode, type ValidationAcceptor, type ValidationChecks } from 'langium';
import {
    isBinaryExpression,
    isBooleanValue,
    isEnumType,
    isIntegerValue,
    isNameReference,
    isPathQuantifiedExpression,
    isRangeType,
    isUnaryExpression,
    type Attribute,
    type Diagram,
    type Expression,
    type Fairness,
    type Specification,
    type State,
    type StateDiagramAstType
} from './generated/ast.js';
import type { StateDiagramServices } from './state-diagram-module.js';

const LTL_OPERATORS = new Set(['G', 'F', 'X', 'U', 'V']);

/** Words reserved by the nuXmv input language that the .nxd grammar does not already reserve. */
export const NUXMV_RESERVED = new Set(
    (
        'MODULE DEFINE MDEFINE CONSTANTS VAR IVAR FROZENVAR INIT TRANS INVAR SPEC CTLSPEC LTLSPEC PSLSPEC COMPUTE ' +
        'NAME INVARSPEC FAIRNESS JUSTICE COMPASSION ISA ASSIGN CONSTRAINT SIMPWFF CTLWFF LTLWFF PSLWFF COMPWFF IN ' +
        'MIN MAX MIRROR PRED PREDICATES process array of boolean integer real word word1 bool signed unsigned ' +
        'extend resize sizeof uwconst swconst EX AX EF AF EG AG E F O G H X Y Z A U S V T BU EBF ABF EBG ABG ' +
        'case esac mod next init union in xor xnor self TRUE FALSE count abs max min toint floor typeof itype ' +
        'set clock time'
    ).split(' ')
);
const CTL_OPERATORS = new Set(['AG', 'AF', 'AX', 'EG', 'EF', 'EX']);

export function registerValidationChecks(services: StateDiagramServices): void {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.StateDiagramValidator;
    const checks: ValidationChecks<StateDiagramAstType> = {
        Diagram: validator.checkDiagram,
        Attribute: validator.checkAttribute,
        State: validator.checkState,
        Specification: validator.checkSpecification,
        Fairness: validator.checkFairness
    };
    registry.register(checks, validator);
}

export function diagramAttributes(diagram: Diagram): Attribute[] {
    return diagram.elements.flatMap(e => (e.$type === 'AttributeBlock' ? e.attributes : []));
}

export function diagramStates(diagram: Diagram): State[] {
    return diagram.elements.filter((e): e is State => e.$type === 'State');
}

export class StateDiagramValidator {
    checkDiagram(diagram: Diagram, accept: ValidationAcceptor): void {
        const states = diagramStates(diagram);
        const attributes = diagramAttributes(diagram);

        reportDuplicates(states, 'state', accept);
        reportDuplicates(attributes, 'attribute', accept);

        const reserved = (node: AstNode & { name: string }, what: string) => {
            if (NUXMV_RESERVED.has(node.name)) {
                accept('error', `'${node.name}' is a reserved word in nuXmv and cannot name ${what}.`, { node, property: 'name' as never });
            }
        };
        states.forEach(s => reserved(s, 'a state'));
        attributes.forEach(a => {
            reserved(a, 'an attribute');
            if (isEnumType(a.type)) a.type.values.forEach(v => reserved(v, 'an enumeration value'));
        });

        const attributeNames = new Set(attributes.map(a => a.name));
        for (const state of states) {
            if (attributeNames.has(state.name)) {
                accept('error', `State '${state.name}' has the same name as an attribute.`, { node: state, property: 'name' });
            }
        }
        for (const attribute of attributes) {
            if (isEnumType(attribute.type)) {
                for (const value of attribute.type.values) {
                    if (attributeNames.has(value.name)) {
                        accept('error', `Enumeration value '${value.name}' clashes with the attribute of the same name.`, { node: value, property: 'name' });
                    }
                }
            }
        }

        if (states.length > 0 && !states.some(s => s.initial)) {
            accept('warning', `No initial state declared: '${states[0].name}' will be used as the initial state.`, {
                node: states[0],
                property: 'name'
            });
        }

        const sources = new Set<string>();
        const seen = new Set<string>();
        for (const element of diagram.elements) {
            if (element.$type !== 'Transition') continue;
            const source = element.source.ref?.name ?? element.source.$refText;
            const target = element.target.ref?.name ?? element.target.$refText;
            sources.add(source);
            const key = `${source}->${target}`;
            if (seen.has(key)) {
                accept('warning', `Duplicate transition ${source} -> ${target}.`, { node: element });
            }
            seen.add(key);
        }
        for (const state of states) {
            if (!sources.has(state.name)) {
                accept('warning', `State '${state.name}' is a dead end (no outgoing transition). The generated model lets it loop on itself.`, {
                    node: state,
                    property: 'name'
                });
            }
        }
    }

    checkAttribute(attribute: Attribute, accept: ValidationAcceptor): void {
        const type = attribute.type;
        if (isRangeType(type) && type.low > type.high) {
            accept('error', `Empty range ${type.low}..${type.high}.`, { node: type });
        }
        if (isEnumType(type)) {
            const seen = new Set<string>();
            for (const value of type.values) {
                if (seen.has(value.name)) {
                    accept('error', `Duplicate enumeration value '${value.name}'.`, { node: value, property: 'name' });
                }
                seen.add(value.name);
            }
        }
    }

    checkState(state: State, accept: ValidationAcceptor): void {
        const assigned = new Set<string>();
        for (const assignment of state.assignments) {
            const attribute = assignment.attribute.ref;
            if (!attribute) continue;
            if (assigned.has(attribute.name)) {
                accept('error', `Attribute '${attribute.name}' is assigned more than once.`, { node: assignment });
            }
            assigned.add(attribute.name);

            const value = assignment.value;
            const type = attribute.type;
            if (type.$type === 'BooleanType') {
                if (!isBooleanValue(value)) {
                    accept('error', `'${attribute.name}' is boolean: expected TRUE or FALSE.`, { node: value });
                }
            } else if (isRangeType(type)) {
                if (!isIntegerValue(value)) {
                    accept('error', `'${attribute.name}' ranges over ${type.low}..${type.high}: expected an integer.`, { node: value });
                } else if (value.value < type.low || value.value > type.high) {
                    accept('error', `${value.value} is outside ${type.low}..${type.high}.`, { node: value });
                }
            } else if (isEnumType(type)) {
                const allowed = type.values.map(v => v.name);
                if (value.$type !== 'SymbolValue' || !allowed.includes(value.symbol)) {
                    accept('error', `'${attribute.name}' takes one of { ${allowed.join(', ')} }.`, { node: value });
                }
            }
        }

        const diagram = AstUtils.getContainerOfType(state, (n): n is Diagram => n.$type === 'Diagram');
        if (diagram) {
            const missing = diagramAttributes(diagram)
                .map(a => a.name)
                .filter(name => !assigned.has(name));
            if (missing.length > 0) {
                accept('info', `No value for ${missing.join(', ')} in '${state.name}': nuXmv may pick any value of the domain.`, {
                    node: state,
                    property: 'name'
                });
            }
        }
    }

    checkSpecification(spec: Specification, accept: ValidationAcceptor): void {
        this.checkNames(spec, spec.expression, accept);
        for (const node of expressionNodes(spec.expression)) {
            const op = temporalOperator(node);
            if (!op) continue;
            const isCtl = CTL_OPERATORS.has(op) || op.endsWith('[..U..]');
            if (spec.kind === 'LTLSPEC' && isCtl) {
                accept('error', `CTL operator '${op}' is not allowed in an LTLSPEC.`, { node });
            } else if (spec.kind === 'CTLSPEC' && LTL_OPERATORS.has(op)) {
                accept('error', `LTL operator '${op}' is not allowed in a CTLSPEC (use A[..U..] / E[..U..] for until).`, { node });
            } else if (spec.kind === 'INVARSPEC') {
                accept('error', `INVARSPEC must be a propositional (state) formula, found '${op}'.`, { node });
            }
        }
    }

    checkFairness(fairness: Fairness, accept: ValidationAcceptor): void {
        this.checkNames(fairness, fairness.expression, accept);
        for (const node of expressionNodes(fairness.expression)) {
            const op = temporalOperator(node);
            if (op) {
                accept('error', `${fairness.kind} constraints must be propositional, found '${op}'.`, { node });
            }
        }
    }

    private checkNames(owner: Specification | Fairness, expression: Expression, accept: ValidationAcceptor): void {
        const diagram = owner.$container;
        const known = new Set<string>();
        for (const attribute of diagramAttributes(diagram)) {
            known.add(attribute.name);
            if (isEnumType(attribute.type)) attribute.type.values.forEach(v => known.add(v.name));
        }
        diagramStates(diagram).forEach(s => known.add(s.name));

        for (const node of expressionNodes(expression)) {
            if (isNameReference(node) && !known.has(node.name)) {
                accept('error', `Unknown name '${node.name}': expected an attribute, a state or an enumeration value.`, {
                    node,
                    property: 'name'
                });
            }
            if (isPathQuantifiedExpression(node) && !(isBinaryExpression(node.body) && node.body.operator === 'U')) {
                accept('error', `Expected ${node.quantifier}[ p U q ].`, { node });
            }
        }
    }
}

function* expressionNodes(expression: Expression): Generator<AstNode> {
    yield expression;
    yield* AstUtils.streamAllContents(expression);
}

function temporalOperator(node: AstNode): string | undefined {
    if (isUnaryExpression(node) && node.operator !== '!' && node.operator !== '-') return node.operator;
    if (isBinaryExpression(node) && (node.operator === 'U' || node.operator === 'V')) {
        // `U` directly inside A[..] / E[..] is part of the CTL operator.
        return isPathQuantifiedExpression(node.$container) ? undefined : node.operator;
    }
    if (isPathQuantifiedExpression(node)) return `${node.quantifier}[..U..]`;
    return undefined;
}

function reportDuplicates(nodes: Array<{ name: string } & AstNode>, what: string, accept: ValidationAcceptor): void {
    const seen = new Set<string>();
    for (const node of nodes) {
        if (seen.has(node.name)) {
            accept('error', `Duplicate ${what} '${node.name}'.`, { node, property: 'name' as never });
        }
        seen.add(node.name);
    }
}
