/** Syntax helpers shared by the tree-sitter front end modules (tree-sitter nodes and text). */
import type { Node } from 'web-tree-sitter';
import type { FieldFact, Location } from '../ir.js';
import type { LanguageProfile } from './languages.js';
import type { FileRec } from './records.js';

export type Values = Set<string> | null;

export const STATEISH = /(state|status|phase|stage|mode|step)_?$/i;
export const IDENT_TYPES = new Set(['identifier', 'type_identifier', 'field_identifier', 'simple_identifier', 'constant', 'name', 'property_identifier', 'namespace_identifier']);
export const LAMBDA_TYPES = /lambda|closure|anonymous_function|function_literal|func_literal|arrow_function|block_argument|^block$|do_block|annotated_lambda/;
export const BLOCK_TYPES = /(^|_)(closure|block|body|statements|statement_list|compound_statement|braced_expression|body_statement|then|else|program|source_file|translation_unit|switch_section|switch_block_statement_group|case_statement|when_entry|match_arm|control_structure_body|declaration_list|function_body|constructor_body|begin|switch_entry|case_clause|expression_case|default_case)$/;
export const EXIT = /^\s*[{(]?\s*(return|throw|raise|break|continue|panic!?|stop|next|exit|fatalError|die)\b/;

export function locOf(r: FileRec, n: Node): Location {
    return { file: r.file, line: n.startPosition.row + 1 };
}

export function lineOf(r: FileRec, n: Node): string {
    return r.text.split('\n')[n.startPosition.row]?.trim() ?? '';
}


/** Languages where a bare field name inside a method refers to `this.field`. */
export const IMPLICIT_THIS = new Set(['java', 'kotlin', 'groovy', 'scala', 'cpp', 'c_sharp', 'swift']);
/** Languages where only an early return skips a release (errors are values). */
export const NO_EXCEPTIONS = new Set(['c', 'go']);
export const AWAIT = /\bawait\b|\.await\b/;

export function walk(node: Node): Node[] {
    const out: Node[] = [];
    const cursor = node.walk();
    let done = false;
    while (!done) {
        if (cursor.nodeIsNamed) out.push(cursor.currentNode);
        if (cursor.gotoFirstChild()) continue;
        while (!cursor.gotoNextSibling()) {
            if (!cursor.gotoParent() || cursor.currentNode.id === node.id) {
                done = true;
                break;
            }
        }
        if (cursor.currentNode.id === node.id) done = true;
    }
    cursor.delete();
    return out;
}

export function descendants(node: Node, ...types: string[]): Node[] {
    if (types.length === 0) return [];
    const set = new Set(types);
    return walk(node).filter(n => set.has(n.type));
}

export function ancestorOf(node: Node, types: string[]): Node | undefined {
    let n = node.parent;
    while (n) {
        if (types.includes(n.type)) return n;
        n = n.parent;
    }
    return undefined;
}

export function nearestOf(node: Node | null, types: Set<string>): Node | undefined {
    let n = node;
    while (n) {
        if (types.has(n.type)) return n;
        n = n.parent;
    }
    return undefined;
}

export function isWithin(inner: Node, outer: Node, strict = false): boolean {
    return inner.startIndex >= outer.startIndex && inner.endIndex <= outer.endIndex && (!strict || inner.id !== outer.id);
}

export function isTopLevel(n: Node, p: LanguageProfile): boolean {
    let a = n.parent;
    while (a) {
        if (p.functions.includes(a.type) || p.classes.includes(a.type) || (p.impls ?? []).includes(a.type)) return false;
        a = a.parent;
    }
    return true;
}

export function lastNamed(n: Node): Node | undefined {
    const named = n.namedChildren.filter((x): x is Node => !!x);
    return named[named.length - 1];
}

export function findChild(n: Node, types: string[]): Node | undefined {
    return (n.namedChildren.find(c => c && types.includes(c.type)) ?? undefined) as Node | undefined;
}

export function lastIdent(text: string | undefined): string | undefined {
    if (!text) return undefined;
    const all = text.match(/[A-Za-z_]\w*/g);
    return all?.[all.length - 1];
}

export function nameOf(n: Node): string | undefined {
    const named = n.childForFieldName('name');
    if (named) return IDENT_TYPES.has(named.type) ? named.text : lastIdent(named.text.split('(')[0]);
    const declarator = n.childForFieldName('declarator');
    if (declarator) return nameOf(declarator) ?? lastIdent(declarator.text.split('(')[0]);
    for (const c of n.namedChildren) if (c && IDENT_TYPES.has(c.type)) return c.text.replace(/^[$@]/, '');
    for (const c of n.namedChildren) {
        if (c && /^(variable_declaration|variable_declarator|pattern|property_element|variable_name|simple_identifier|bound_identifier)$/.test(c.type)) return nameOf(c) ?? lastIdent(c.text);
    }
    return undefined;
}

/** The name of an enum; C `typedef enum { ... } state_t` is named by its typedef. */
export function enumName(n: Node): string | undefined {
    const own = n.childForFieldName('name')?.text ?? (n.namedChildren.find(c => c && IDENT_TYPES.has(c.type)) ?? null)?.text;
    if (own) return own;
    if (n.parent?.type === 'type_definition') return n.parent.childForFieldName('declarator')?.text;
    return undefined;
}

export function header(n: Node): string {
    const body = n.childForFieldName('body');
    return body ? n.text.slice(0, body.startIndex - n.startIndex) : n.text.split('\n')[0];
}

export function modifiersText(n: Node): string {
    return n.namedChildren
        .filter(c => c && /modifier|visibility|access|annotation|storage_class/.test(c.type))
        .map(c => c!.text)
        .join(' ');
}

export function cppAccess(fn: Node): FieldFact['visibility'] {
    const list = fn.parent;
    if (!list || list.type !== 'field_declaration_list') return 'public';
    let access: FieldFact['visibility'] = list.parent?.type === 'class_specifier' ? 'private' : 'public';
    for (const c of list.namedChildren) {
        if (!c) continue;
        if (c.id === fn.id) break;
        if (c.type === 'access_specifier') access = /private/.test(c.text) ? 'private' : /protected/.test(c.text) ? 'protected' : 'public';
    }
    return access;
}

export function typeText(n: Node | undefined): string | undefined {
    if (!n) return undefined;
    return n.text.replace(/^:\s*/, '').trim();
}

export function valueOf(n: Node): Node | undefined {
    const v = n.childForFieldName('value') ?? n.childForFieldName('default_value') ?? n.childForFieldName('initializer');
    if (v) return v.type === 'equals_value_clause' || v.type === 'property_initializer' ? lastNamed(v) : v;
    const eq = n.namedChildren.find(c => c && /equals_value_clause|property_initializer|initializer/.test(c.type));
    if (eq) return lastNamed(eq);
    // Kotlin property_declaration: the expression after '='.
    const children = n.children.filter((x): x is Node => !!x);
    const i = children.findIndex(c => c.type === '=');
    return i >= 0 ? children.slice(i + 1).find(c => c.isNamed) : undefined;
}

export function paramsOf(fn: Node): string[] {
    const params = fn.childForFieldName('parameters') ?? findChild(fn, ['function_value_parameters', 'parameter_list', 'formal_parameters', 'parameters', 'method_parameters']);
    if (!params) return [];
    return params.namedChildren
        .filter((c): c is Node => !!c && !/self_parameter|comment/.test(c.type))
        .map(c => (c.childForFieldName('pattern') ? lastIdent(c.childForFieldName('pattern')!.text) : nameOf(c) ?? lastIdent(c.text.split(/[:=]/)[0])))
        .filter((x): x is string => !!x && !['self', 'this', 'cls'].includes(x));
}

interface Arg {
    name?: string;
    value?: Node;
}

export function argumentsOf(call: Node): Arg[] {
    const args = call.childForFieldName('arguments') ?? findChild(call, ['arguments', 'argument_list', 'value_arguments', 'call_suffix']);
    if (!args) return [];
    return args.namedChildren
        .filter((c): c is Node => !!c && !/comma|comment/.test(c.type))
        .map(a => (a.type === 'argument' || a.type === 'value_argument' ? { name: a.childForFieldName('name')?.text, value: a.childForFieldName('value') ?? lastNamed(a) } : { value: a }));
}

export function calleeOf(call: Node): string | undefined {
    if (call.type === 'object_creation_expression' || call.type === 'new_expression' || call.type === 'instance_expression') {
        const type = call.childForFieldName('type') ?? call.namedChildren.find(c => c && /type|name|identifier/.test(c.type));
        return type ? `new ${type.text.replace(/<.*$/, '')}` : undefined;
    }
    if (call.type === 'delete_expression') return 'delete';
    const object = call.childForFieldName('object') ?? call.childForFieldName('receiver') ?? call.childForFieldName('scope');
    const method = call.childForFieldName('name') ?? call.childForFieldName('method');
    if (object && method) return `${object.text}.${method.text}`.replace(/\s+/g, '');
    const fn = call.childForFieldName('function') ?? method ?? call.namedChildren[0];
    return fn?.text.replace(/\s+/g, '').replace(/->/g, '.').replace(/::(?=\w+$)/, '::');
}

export function normaliseHandle(p: LanguageProfile, handle: string, receiver?: string): string {
    const t = handle.trim().replace(/^&/, '');
    if (p.self.test(t)) return `this.${t.replace(p.self, '')}`;
    if (receiver && t.startsWith(`${receiver}.`)) return `this.${t.slice(receiver.length + 1)}`;
    return t;
}

export function importSpec(p: LanguageProfile, n: Node): string | undefined {
    switch (p.id) {
        case 'ruby': {
            const method = n.childForFieldName('method')?.text;
            if (!method || !['require', 'require_relative', 'load'].includes(method)) return undefined;
            return argumentsOf(n)[0]?.value?.text.replace(/^["']|["']$/g, '');
        }
        case 'r': {
            const fn = n.childForFieldName('function')?.text;
            if (!fn || !['library', 'require', 'source', 'requireNamespace'].includes(fn)) return undefined;
            return argumentsOf(n)[0]?.value?.text.replace(/^["']|["']$/g, '');
        }
        case 'c':
        case 'cpp': {
            const path = n.childForFieldName('path')?.text ?? '';
            return path.startsWith('"') ? path.replace(/^"|"$/g, '') : undefined;
        }
        case 'go':
            return n.childForFieldName('path')?.text.replace(/^"|"$/g, '');
        case 'rust':
            return n.type === 'mod_item' ? (n.childForFieldName('body') ? undefined : nameOf(n)) : n.childForFieldName('argument')?.text;
        case 'php': {
            const s = n.text.replace(/^(require|include)(_once)?\s*\(?|\)?\s*;?$/g, '').trim();
            return s.replace(/^\\|;$/g, '').replace(/^["']|["']$/g, '').replace(/\s+as\s+\w+$/, '');
        }
        default:
            return n.text
                .replace(/^\s*(import|using|use)\s+(static\s+)?/, '')
                .replace(/;\s*$/, '')
                .replace(/\s+as\s+\w+$/, '')
                .trim();
    }
}

/** A literal the code writes: string, symbol, `.member` (Swift), `Enum.MEMBER` / `Enum::Member`, or a bare identifier. */
export function constantOf(raw: string): { kind: 'string' | 'symbol' | 'member' | 'ident'; value: string; qualifier?: string } | undefined {
    const text = raw.trim().replace(/^\(+|\)+$/g, '').replace(/^&/, '').trim();
    let m = /^(["'`])((?:(?!\1).)*)\1$/.exec(text);
    if (m) return { kind: 'string', value: m[2] };
    m = /^:(\w+)$/.exec(text);
    if (m) return { kind: 'symbol', value: m[1] };
    m = /^\.(\w+)$/.exec(text);
    if (m) return { kind: 'member', value: m[1] };
    m = /^\\?((?:\w+(?:\.|::|\\))*\w+)(?:\.|::|->)(\w+)$/.exec(text);
    if (m && !/^(this|self|\$this)$/.test(m[1])) return { kind: 'member', value: m[2], qualifier: m[1] };
    m = /^([A-Za-z_]\w*)$/.exec(text);
    if (m && !/^(true|false|null|nil|None|TRUE|FALSE|NULL|this|self)$/.test(m[1])) return { kind: 'ident', value: m[1] };
    return undefined;
}

export function unwrap(n: Node): Node {
    let x = n;
    while (/^(parenthesized_expression|parenthesized|condition|condition_clause|expression_list|when_subject|value_argument)$/.test(x.type) && x.namedChildren.length === 1 && x.namedChildren[0]) x = x.namedChildren[0];
    if (x.type === 'condition_clause' && x.childForFieldName('value')) return unwrap(x.childForFieldName('value')!);
    return x;
}

export function operatorOf(n: Node): string | undefined {
    const field = n.childForFieldName('operator');
    if (field) return field.text;
    for (const c of n.children) {
        if (c && !c.isNamed && /^(==|===|!=|!==|&&|\|\||and|or|is|%in%|in|!in|<-|<<-|->|->>|=|\+=|-=|\*=|\/=|eq|ne|&|\|)$/.test(c.text)) return c.text;
        if (c && c.type === 'equality_operator') return c.text;
    }
    if (n.type === 'equality_expression' || n.type === 'infix_expression') {
        const mid = n.children[1];
        if (mid) return mid.text;
    }
    return undefined;
}

export function isComparison(n: Node): boolean {
    if (n.type === 'let_condition') return true;
    const op = operatorOf(n);
    return !!op && ['==', '===', '!=', '!==', 'is', '!is', '%in%', 'in', '!in', 'eq', 'ne'].includes(op) && !/assignment|binary_operator$/.test(n.type) || (n.type === 'binary_operator' && ['==', '!=', '%in%'].includes(op ?? ''));
}

export function isNegation(n: Node): boolean {
    if (!/unary|prefix|not/.test(n.type)) return false;
    const first = n.children[0];
    return !!first && (first.text === '!' || first.text === 'not');
}

export function sides(n: Node): [Node | undefined, Node | undefined] {
    const left = n.childForFieldName('left') ?? n.childForFieldName('lhs') ?? n.namedChildren[0] ?? undefined;
    const right = n.childForFieldName('right') ?? n.childForFieldName('rhs') ?? lastNamed(n);
    return [left ?? undefined, right && right.id !== left?.id ? right : undefined];
}

export function ifParts(n: Node): { cond?: Node; then?: Node; else?: Node } {
    const cond = n.childForFieldName('condition') ?? n.namedChildren[0] ?? undefined;
    let then = n.childForFieldName('consequence') ?? n.childForFieldName('body') ?? undefined;
    let other = n.childForFieldName('alternative') ?? undefined;
    const rest = n.namedChildren.filter((c): c is Node => !!c && c.id !== cond?.id);
    if (!then) then = rest.find(c => c.id !== other?.id && !/else/.test(c.type));
    if (!other) other = rest.find(c => c.id !== then?.id && (/else/.test(c.type) || rest.indexOf(c) > rest.indexOf(then!)));
    return { cond: cond ?? undefined, then, else: other };
}

export function switchSubject(sw: Node): Node | undefined {
    return sw.childForFieldName('condition') ?? sw.childForFieldName('value') ?? sw.childForFieldName('subject') ?? sw.childForFieldName('expr') ?? findChild(sw, ['when_subject', 'parenthesized_expression']) ?? sw.namedChildren[0] ?? undefined;
}

export function isDefaultCase(c: Node): boolean {
    if (/default|^else$|match_default/.test(c.type)) return true;
    if (c.namedChildren.some(x => x && /default_switch_label|default_keyword/.test(x.type))) return true;
    const pattern = c.childForFieldName('pattern')?.text.trim();
    if (pattern === '_' || pattern === 'default') return true;
    if (c.type === 'when_entry' && !c.namedChildren.some(x => x?.type === 'when_condition')) return true;
    if (c.type === 'switch_block_statement_group' || c.type === 'switch_rule') return /^\s*default\b/.test(c.text);
    return /^\s*(default|else)\b|^\s*case\s+_\b/.test(c.text);
}

/** A closure that is the body of an if/else/loop (Groovy parses `if (c) { ... }` bodies as closures) is a block. */
export function isLambda(n: Node): boolean {
    if (!LAMBDA_TYPES.test(n.type) || n.type === 'block') return false;
    if (n.type === 'closure') {
        const holder = n.parent?.type === 'expression_statement' ? n.parent.parent : n.parent;
        if (holder && /^(if_statement|else|while_statement|for_statement|enhanced_for_statement|do_statement|switch_block_statement_group|try_statement|catch_clause|finally_clause)$/.test(holder.type)) return false;
    }
    return true;
}

export function functionBoundary(node: Node, method: Node | undefined, p: LanguageProfile): Node {
    let n = node.parent;
    while (n) {
        if (isLambda(n) && method && isWithin(n, method, true)) return n;
        if (p.functions.includes(n.type) || n.id === method?.id) return n;
        n = n.parent;
    }
    return method ?? node;
}

export function insideLambda(node: Node, method: Node): boolean {
    let n = node.parent;
    while (n && n.id !== method.id) {
        if (isLambda(n)) return true;
        n = n.parent;
    }
    return false;
}

export function lastLine(body: string): string {
    const lines = body.replace(/\}\s*$/, '').replace(/\bend\s*$/, '').trim().split('\n');
    return lines[lines.length - 1] ?? '';
}

export function escape(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function union(a: Values, b: Values): Values {
    return !a || !b ? null : new Set([...a, ...b]);
}

export function intersect(a: Values, b: Values): Values {
    if (!a) return b ? new Set(b) : null;
    if (!b) return new Set(a);
    return new Set([...a].filter(v => b.has(v)));
}

