/**
 * Front end for Java, Kotlin, Groovy, Scala, C, C++, C#, Go, Rust, Swift,
 * Ruby, PHP and R, on tree-sitter grammars (WebAssembly, no native build).
 * The language profiles (languages.ts) name the syntax; this module turns any
 * of them into the same facts as the TypeScript and Python front ends: state
 * variables (fields typed or assigned with enum members, or state-like fields
 * set to strings/symbols) with the states each write can happen in, and
 * switches. Declarations, resources and code shape have their own modules.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser, type Node } from 'web-tree-sitter';
import { emptyFacts, type Facts } from '../ir.js';
import { isTestFile } from '../scan.js';
import { Declarations } from './declarations.js';
import { PROFILES, profileFor, type LanguageProfile } from './languages.js';
import type { ClassRec, Context, Field, FileRec, Var } from './records.js';
import { resourceOp } from './resources.js';
import { classFact, functionFacts, instantiationFacts, interfaceFacts, moduleFact } from './shapes.js';
import {
    ancestorOf,
    argumentsOf,
    AWAIT,
    BLOCK_TYPES,
    constantOf,
    descendants,
    EXIT,
    functionBoundary,
    IMPLICIT_THIS,
    ifParts,
    insideLambda,
    intersect,
    isComparison,
    isDefaultCase,
    isNegation,
    isWithin,
    lastIdent,
    lastNamed,
    lineOf,
    locOf,
    operatorOf,
    sides,
    STATEISH,
    switchSubject,
    union,
    unwrap,
    walk,
    type Values
} from './syntax.js';

export { TREE_SITTER_EXTENSIONS } from './languages.js';

// ------------------------------------------------------------------ loading

/** WebAssembly runtime, started once when the module loads (errors surface when a grammar is loaded). */
const ready: Promise<void> = Parser.init();
ready.catch(() => undefined);
const languages = new Map<string, Language>();

function grammarPath(profile: LanguageProfile): string {
    if (profile.vendored) return fileURLToPath(new URL(`../../grammars/${profile.grammar}`, import.meta.url));
    const require = createRequire(import.meta.url);
    return join(dirname(require.resolve('tree-sitter-wasms/package.json')), 'out', profile.grammar);
}

async function languageOf(profile: LanguageProfile): Promise<Language> {
    await ready;
    let language = languages.get(profile.id);
    if (!language) {
        language = await Language.load(readFileSync(grammarPath(profile)));
        languages.set(profile.id, language);
    }
    return language;
}

// ------------------------------------------------------------------- entry

export async function extractTreeSitter(root: string, files: string[], overrides?: Map<string, string>): Promise<Facts> {
    const facts = emptyFacts(root);
    const cppProject = files.some(f => /\.(cpp|cc|cxx|hpp|hh|hxx)$/.test(f));
    const recs: FileRec[] = [];
    for (const file of files) {
        const profile = profileFor(file, cppProject);
        if (!profile) continue;
        let text: string;
        try {
            text = overrides?.get(file) ?? readFileSync(resolve(root, file), 'utf8');
        } catch {
            continue;
        }
        let language: Language;
        try {
            language = await languageOf(profile);
        } catch (error) {
            facts.notes.push(`${profile.name} grammar could not be loaded (${(error as Error).message}); ${file} skipped.`);
            continue;
        }
        const parser = new Parser();
        parser.setLanguage(language);
        const source = profile.preprocess ? profile.preprocess(text) : text;
        const tree = parser.parse(source);
        parser.delete();
        if (!tree) continue;
        recs.push({ file, profile, tree, text: source, test: isTestFile(file), classes: [], globals: new Map(), functions: [] });
        facts.files.push(file);
    }
    const x = new TreeSitterExtractor(facts, recs);
    x.run();
    for (const r of recs) r.tree.delete();
    return facts;
}

// --------------------------------------------------------------- extractor

class TreeSitterExtractor {
    private readonly enumTables = new Map<string, Map<string, string[]>>();
    /** Enums visible from the file being processed (same language; the file's own declarations win). */
    private enums = new Map<string, string[]>();
    private readonly vars: Var[] = [];
    private readonly classesByName = new Map<string, ClassRec[]>();

    private readonly declarations: Declarations;

    constructor(
        private readonly facts: Facts,
        private readonly recs: FileRec[]
    ) {
        this.declarations = new Declarations(recs);
    }

    run(): void {
        for (const r of this.recs) this.declarations.collectEnums(r);
        for (const r of this.recs) this.declarations.collectDeclarations(r);
        for (const r of this.recs) for (const c of r.classes) this.classesByName.set(c.name, [...(this.classesByName.get(c.name) ?? []), c]);
        for (const r of this.recs) {
            this.scope(r);
            this.findStateVariables(r);
        }
        for (const r of this.recs) {
            this.scope(r);
            this.visitBodies(r);
        }
        this.finishVariables();
        for (const r of this.recs) {
            this.facts.modules.push(moduleFact(this.recs, r));
            for (const c of r.classes) this.facts.classes.push(classFact(this.recs, r, c));
            this.facts.functions.push(...functionFacts(r));
            this.facts.instantiations.push(...instantiationFacts(this.recs, this.classesByName, r));
            this.facts.interfaces.push(...interfaceFacts(r));
        }
    }


    private scope(r: FileRec): void {
        let table = this.enumTables.get(r.file);
        if (!table) {
            table = new Map();
            const decls = this.declarations.enumDecls.get(r.profile.id) ?? [];
            for (const e of decls.filter(d => d.file !== r.file)) if (!table.has(e.name)) table.set(e.name, e.members);
            for (const e of decls.filter(d => d.file === r.file)) table.set(e.name, e.members);
            this.enumTables.set(r.file, table);
        }
        this.enums = table;
    }

    // ------------------------------------------------------ state variables

    private findStateVariables(r: FileRec): void {
        const owners: Array<{ cls?: ClassRec; fields: Map<string, Field> }> = [...r.classes.map(c => ({ cls: c, fields: c.fields })), { fields: r.globals }];
        for (const { cls, fields } of owners) {
            for (const f of fields.values()) {
                if (isTestFile(r.file)) continue;
                const typed = f.type && this.enumOfType(f.type);
                const initValue = f.init ? constantOf(f.init.text) : undefined;
                const inferredEnum = initValue?.qualifier && this.enums.has(lastIdent(initValue.qualifier) ?? '') ? lastIdent(initValue.qualifier) : initValue && !initValue.qualifier && initValue.kind === 'ident' ? this.enumOfMember(initValue.value) : undefined;
                const enumName = typed || inferredEnum || undefined;
                const stringy = !enumName && STATEISH.test(f.name) && (!f.init || (initValue && (initValue.kind === 'string' || initValue.kind === 'symbol')));
                if (!enumName && !stringy) continue;
                if (!enumName && !STATEISH.test(f.name)) continue;
                const ownerName = cls?.name ?? r.file.split('/').pop()!.replace(/\.[^.]+$/, '');
                const name = `${ownerName}.${f.name}`;
                const v: Var = {
                    fact: { id: `${r.file}#${name}`, name, language: r.profile.id, values: enumName ? [...this.enums.get(enumName)!] : [], inferred: !enumName, initial: [], loc: f.loc, owner: ownerName },
                    enumName,
                    owner: cls,
                    field: f.name,
                    fileRec: r,
                    initial: new Set()
                };
                if (f.init) for (const x of this.valuesFor(v, f.init) ?? []) v.initial.add(x);
                this.vars.push(v);
            }
        }
        // Ruby / R / untyped fields assigned enum members or literals only in methods: found while visiting.
    }

    private enumOfType(type: string): string | undefined {
        const name = type.replace(/[?*&]|\bconst\b|\bmut\b/g, '').replace(/^.*[.:]/, '').replace(/<.*$/, '').trim();
        const inner = /(?:Optional|Option|Nullable)<\s*(\w+)\s*>/.exec(type)?.[1];
        return this.enums.has(name) ? name : inner && this.enums.has(inner) ? inner : undefined;
    }

    private enumOfMember(member: string): string | undefined {
        const owners = [...this.enums].filter(([, m]) => m.includes(member)).map(([e]) => e);
        return owners.length === 1 ? owners[0] : undefined;
    }

    /** Values of an expression for a variable: enum members of its enum, or literals for an inferred domain. */
    private valuesFor(v: Var, node: Node): string[] | null {
        this.scope(v.fileRec);
        const n = unwrap(node);
        if (/ternary|conditional_expression/.test(n.type)) {
            const branches = n.namedChildren.slice(-2).filter((x): x is Node => !!x);
            const vals = branches.map(b => this.valuesFor(v, b));
            return vals.every(x => x) ? [...new Set(vals.flat() as string[])] : null;
        }
        const c = constantOf(n.text);
        if (!c) return null;
        if (v.enumName) {
            const members = this.enums.get(v.enumName)!;
            if ((c.kind === 'member' || c.kind === 'ident') && members.includes(c.value) && (!c.qualifier || lastIdent(c.qualifier) === v.enumName || !this.enums.has(lastIdent(c.qualifier) ?? ''))) return [c.value];
            return null;
        }
        return c.kind === 'string' || c.kind === 'symbol' ? [c.value] : null;
    }

    /** The state variable an expression (text) refers to in a context. */
    private varOf(ctx: Context, node: Node | null | undefined): Var | undefined {
        if (!node) return undefined;
        const p = ctx.rec.profile;
        let text = unwrap(node).text.trim().replace(/\(\s*\)$/, '');
        const selfish = p.self.test(text) || (ctx.method?.receiver && text.startsWith(`${ctx.method.receiver}.`));
        text = text.replace(p.self, '');
        if (ctx.method?.receiver) text = text.replace(new RegExp(`^${ctx.method.receiver}\\.`), '');
        if (/^\w+$/.test(text)) {
            if (ctx.cls && (selfish || IMPLICIT_THIS.has(p.id))) {
                const own = this.vars.find(v => v.owner === ctx.cls && v.field === text) ?? this.inheritedVar(ctx.cls, text);
                if (own) return own;
                if (selfish) return this.adopt(ctx, text);
            }
            if (!selfish) return this.vars.find(v => !v.owner && v.fileRec === ctx.rec && v.field === text) ?? this.vars.find(v => !v.owner && v.field === text && v.fileRec.profile.id === p.id && (p.id === 'go' || p.id === 'c' || p.id === 'cpp'));
            return undefined;
        }
        const member = /^(\w+)\s*(?:\.|->|\$|::)\s*(\w+)$/.exec(text);
        if (member) {
            const candidates = this.vars.filter(v => v.owner && v.field === member[2] && v.fileRec.profile.id === p.id);
            if (candidates.length === 1) return candidates[0];
        }
        return undefined;
    }

    private inheritedVar(cls: ClassRec, field: string): Var | undefined {
        let base = cls.extends;
        for (let i = 0; base && i < 5; i++) {
            const parent = this.classesByName.get(base)?.[0];
            const v = this.vars.find(x => x.owner === parent && x.field === field);
            if (v) return v;
            base = parent?.extends;
        }
        return undefined;
    }

    /** Ruby @state, R self$state, untyped fields: become state variables when written with enum members or state literals. */
    private adopt(ctx: Context, field: string): Var | undefined {
        if (!ctx.cls || isTestFile(ctx.rec.file)) return undefined;
        const f = ctx.cls.fields.get(field);
        if (f?.type && !this.enumOfType(f.type)) return undefined;
        const name = `${ctx.cls.name}.${field}`;
        const v: Var = {
            fact: { id: `${ctx.rec.file}#${name}`, name, language: ctx.rec.profile.id, values: [], inferred: true, initial: [], loc: f?.loc ?? locOf(ctx.rec, ctx.cls.node), owner: ctx.cls.name },
            owner: ctx.cls,
            field,
            fileRec: ctx.rec,
            initial: new Set()
        };
        this.vars.push(v);
        return v;
    }

    // --------------------------------------------------------------- bodies

    private visitBodies(r: FileRec): void {
        const p = r.profile;
        const contexts: Array<{ ctx: Context; node: Node }> = [
            ...r.classes.flatMap(cls => cls.methods.map(method => ({ ctx: { rec: r, cls, method }, node: method.node }))),
            ...r.functions.map(method => ({ ctx: { rec: r, method }, node: method.node }))
        ];
        for (const { ctx, node } of contexts) {
            for (const n of walk(node)) {
                // Nested named functions are visited as their own context.
                if (n.id !== node.id && p.functions.includes(n.type) && n.type !== 'function_definition') continue;
                if (n.id !== node.id && ancestorOf(n, p.functions)?.id !== node.id && p.id !== 'r') continue;
                if (p.assignments.includes(n.type)) this.assignment(ctx, n);
                if (isComparison(n)) this.comparison(ctx, n, true);
                if (p.switches.includes(n.type) || (p.id === 'r' && n.type === 'call' && n.childForFieldName('function')?.text === 'switch')) this.switchFact(ctx, n);
                if (p.calls.includes(n.type) || n.type === 'delete_expression') {
                    const op = resourceOp(ctx, n, this.facts.resources);
                    if (op) this.facts.resources.push(op);
                }
            }
        }
        // Struct literals and designated initialisers: initial values.
        for (const n of descendants(r.tree.rootNode, ...(p.structFields ?? []))) {
            const key = (n.childForFieldName('field') ?? n.childForFieldName('designator') ?? n.namedChildren[0])?.text.replace(/^\./, '');
            const value = n.childForFieldName('value') ?? lastNamed(n);
            if (!key || !value) continue;
            const candidates = this.vars.filter(v => v.field === key && v.fileRec.profile.id === p.id);
            if (candidates.length === 1) for (const x of this.valuesFor(candidates[0], value) ?? []) candidates[0].initial.add(x);
        }
        // Field initialisers of adopted (untyped) fields.
        for (const v of this.vars.filter(x => x.fileRec === r && x.owner)) {
            const f = v.owner!.fields.get(v.field);
            if (f?.init) for (const x of this.valuesFor(v, f.init) ?? []) v.initial.add(x);
        }
    }

    private assignment(ctx: Context, n: Node): void {
        const p = ctx.rec.profile;
        let lhs: Node | null | undefined = n.childForFieldName('left') ?? n.childForFieldName('lhs') ?? n.childForFieldName('target') ?? n.namedChildren[0];
        let rhs: Node | null | undefined = n.childForFieldName('right') ?? n.childForFieldName('rhs') ?? n.childForFieldName('result') ?? lastNamed(n);
        if (p.id === 'r') {
            const op = operatorOf(n);
            if (!op || !['<-', '=', '<<-', '->', '->>'].includes(op)) return;
            if (op === '->' || op === '->>') [lhs, rhs] = [rhs, lhs];
        }
        if (p.id === 'go') {
            lhs = lhs?.namedChildren[0] ?? lhs;
            rhs = rhs?.namedChildren[0] ?? rhs;
        }
        if (!lhs || !rhs || lhs.id === rhs.id) return;
        if (n.type === 'operator_assignment' || /^[+\-*/%|&^]=/.test(operatorOf(n) ?? '=')) return;
        let v = this.varOf(ctx, lhs);
        const c = constantOf(unwrap(rhs).text);
        if (!v && c && ctx.cls) {
            // An untyped field written with an enum member or a state-like literal becomes a state variable.
            const selfish = p.self.test(unwrap(lhs).text) || (ctx.method?.receiver && unwrap(lhs).text.startsWith(`${ctx.method.receiver}.`));
            const field = unwrap(lhs).text.replace(p.self, '').replace(new RegExp(`^${ctx.method?.receiver ?? '\\0'}\\.`), '');
            const known = ctx.cls.fields.has(field);
            if (/^\w+$/.test(field) && (selfish || known)) {
                const enumName = c.qualifier ? lastIdent(c.qualifier) : c.kind === 'ident' ? this.enumOfMember(c.value) : undefined;
                if ((enumName && this.enums.has(enumName)) || ((c.kind === 'string' || c.kind === 'symbol') && STATEISH.test(field))) {
                    v = this.adopt(ctx, field);
                    if (v && enumName && this.enums.has(enumName) && v.fact.values.length === 0) {
                        v.enumName = enumName;
                        v.fact.values = [...this.enums.get(enumName)!];
                        v.fact.inferred = false;
                    }
                }
            }
        }
        if (!v) return;
        const values = this.valuesFor(v, rhs);
        if (ctx.method?.ctor && !insideLambda(n, ctx.method.node)) {
            for (const x of values ?? []) v.initial.add(x);
            return;
        }
        const flow = this.sourcesOf(ctx, n, v);
        this.facts.writes.push({
            variable: v.fact.id,
            targets: values,
            sources: flow.values ? [...flow.values] : null,
            event: this.eventOf(ctx, n),
            loc: locOf(ctx.rec, n),
            afterAwait: flow.afterAwait,
            text: lineOf(ctx.rec, n)
        });
    }

    private eventOf(ctx: Context, n: Node): string {
        const base = ctx.cls ? `${ctx.cls.name}.${ctx.method?.name ?? 'init'}` : ctx.method?.name ?? 'module';
        return ctx.method && insideLambda(n, ctx.method.node) ? `${base} (callback)` : base;
    }

    /** `x == V`, `x != V`, `V.equals(x)`, `x %in% c(...)`: the variable and the values. */
    private comparison(ctx: Context, n: Node, record: boolean): { v: Var; values: Set<string>; negated: boolean } | undefined {
        const op = operatorOf(n);
        if (n.type === 'let_condition') {
            const pattern = n.childForFieldName('pattern');
            const value = n.childForFieldName('value');
            const v = this.varOf(ctx, value);
            const vals = v && pattern && this.patternValues(v, pattern);
            if (v && vals) return this.read(ctx, n, v, vals, false, record);
            return undefined;
        }
        if (!op) return undefined;
        const [left, right] = sides(n);
        if (!left || !right) return undefined;
        if (['==', '===', '!=', '!==', 'is', 'is not', '!is', 'eq', 'ne'].includes(op)) {
            for (const [a, b] of [[left, right], [right, left]]) {
                const v = this.varOf(ctx, a);
                if (!v) continue;
                const vals = this.valuesFor(v, b);
                if (vals) return this.read(ctx, n, v, vals, ['!=', '!==', 'is not', '!is', 'ne'].includes(op), record);
            }
        }
        if (['%in%', 'in', '!in', 'not in'].includes(op)) {
            const v = this.varOf(ctx, left);
            if (!v) return undefined;
            const vals = [...right.text.matchAll(/(?:["'](\w[\w-]*)["']|:(\w+)|(?:\w+\s*(?:\.|::))?\b([A-Za-z_]\w*)\b)/g)].map(m => m[1] ?? m[2] ?? m[3]).filter(x => v.enumName ? this.enums.get(v.enumName)!.includes(x) : /["':]/.test(right.text));
            if (vals.length) return this.read(ctx, n, v, vals, op === '!in' || op === 'not in', record);
        }
        return undefined;
    }

    private read(ctx: Context, n: Node, v: Var, values: string[], negated: boolean, record: boolean) {
        if (record) this.facts.reads.push({ variable: v.fact.id, values, loc: locOf(ctx.rec, n) });
        return { v, values: new Set(values), negated };
    }

    private patternValues(v: Var, pattern: Node): string[] | null {
        const text = pattern.text.trim();
        if (/^(_|default|else)$/.test(text)) return null;
        const values = text.split(/\s*\|\s*|\s*,\s*/).map(t => this.valuesForText(v, t));
        return values.every(x => x) ? [...new Set(values.flat() as string[])] : null;
    }

    private valuesForText(v: Var, text: string): string[] | null {
        this.scope(v.fileRec);
        const c = constantOf(text);
        if (!c) return null;
        if (v.enumName) return (c.kind === 'member' || c.kind === 'ident') && this.enums.get(v.enumName)!.includes(c.value) ? [c.value] : null;
        return c.kind === 'string' || c.kind === 'symbol' ? [c.value] : null;
    }

    // --------------------------------------------------------------- flow

    private constraint(ctx: Context, node: Node, v: Var, positive: boolean): Values {
        const n = unwrap(node);
        const domain = new Set(this.domainOf(v));
        const op = operatorOf(n);
        if (isNegation(n)) {
            const operand = n.namedChildren[n.namedChildren.length - 1];
            return operand ? this.constraint(ctx, operand, v, !positive) : null;
        }
        if (op && ['&&', '||', 'and', 'or', '&', '|'].includes(op) && !isComparison(n)) {
            const [a, b] = sides(n);
            if (!a || !b) return null;
            const ca = this.constraint(ctx, a, v, positive);
            const cb = this.constraint(ctx, b, v, positive);
            const conjunction = ['&&', 'and', '&'].includes(op) === positive;
            return conjunction ? intersect(ca, cb) : union(ca, cb);
        }
        const leaf = this.comparison(ctx, n, false);
        if (!leaf || leaf.v !== v) return null;
        const holds = leaf.negated ? !positive : positive;
        return holds ? leaf.values : new Set([...domain].filter(x => !leaf.values.has(x)));
    }

    private domainOf(v: Var): string[] {
        this.scope(v.fileRec);
        return v.enumName ? this.enums.get(v.enumName) ?? v.fact.values : v.fact.values;
    }

    private sourcesOf(ctx: Context, node: Node, v: Var): { values: Values; afterAwait: boolean } {
        const p = ctx.rec.profile;
        const boundary = functionBoundary(node, ctx.method?.node, p);
        let allowed: Values = null;
        const extra = new Set<string>();
        let anchored = false;
        let afterAwait = AWAIT.test(node.text);
        const anchor = (c: Values) => {
            if (c) {
                allowed = intersect(allowed, c);
                anchored = true;
            }
        };
        let current: Node = node;
        while (current.parent && current.id !== boundary.id) {
            const parent: Node = current.parent;
            if (p.ifs.includes(parent.type)) {
                const parts = ifParts(parent);
                const flip = p.unless?.includes(parent.type) ?? false;
                if (parts.cond && !isWithin(current, parts.cond)) {
                    if (parts.then && isWithin(current, parts.then)) anchor(this.constraint(ctx, parts.cond, v, !flip));
                    else if (parts.else && isWithin(current, parts.else)) anchor(this.constraint(ctx, parts.cond, v, flip));
                }
            } else if (p.cases.includes(parent.type)) {
                anchor(this.caseConstraint(ctx, parent, v));
            } else if (/^try/.test(parent.type) && current.id !== parent.childForFieldName('body')?.id) {
                const body = parent.childForFieldName('body') ?? parent.namedChildren[0];
                if (body && body.id !== current.id) {
                    for (const w of this.writesIn(ctx, body, v)) extra.add(w);
                    if (!anchored && AWAIT.test(body.text)) afterAwait = true;
                }
            }
            if (!anchored && BLOCK_TYPES.test(parent.type)) {
                const siblings = parent.namedChildren.filter((x): x is Node => !!x);
                const index = siblings.findIndex(s => s.id === current.id);
                for (let i = index - 1; i >= 0 && !anchored; i--) {
                    const s = siblings[i];
                    const definite = this.definiteWrite(ctx, s, v);
                    if (definite) {
                        allowed = intersect(new Set(definite), allowed);
                        anchored = true;
                        break;
                    }
                    const exit = this.earlyExit(ctx, s, v);
                    if (exit) anchor(exit);
                    if (anchored) break;
                    for (const w of this.writesIn(ctx, s, v)) extra.add(w);
                    if (AWAIT.test(s.text)) afterAwait = true;
                }
            }
            current = parent;
        }
        if (!anchored) return { values: null, afterAwait: false };
        const values = allowed as Set<string> | null;
        if (values) extra.forEach(x => values.add(x));
        return { values, afterAwait };
    }

    private caseConstraint(ctx: Context, caseNode: Node, v: Var): Values {
        const sw = ancestorOf(caseNode, ctx.rec.profile.switches);
        if (!sw || this.varOf(ctx, switchSubject(sw)) !== v) return null;
        const labels = (c: Node) => this.caseLabels(c).flatMap(t => this.valuesForText(v, t) ?? []);
        if (isDefaultCase(caseNode)) {
            const listed = new Set(this.casesOf(ctx, sw).flatMap(labels));
            return new Set(this.domainOf(v).filter(x => !listed.has(x)));
        }
        const values = labels(caseNode);
        return values.length ? new Set(values) : null;
    }

    private casesOf(ctx: Context, sw: Node): Node[] {
        return descendants(sw, ...ctx.rec.profile.cases).filter(c => ancestorOf(c, ctx.rec.profile.switches)?.id === sw.id);
    }

    /** Label texts of a case (`case A, B:`, `A | B =>`, `when :a, :b`, `State.A ->`). */
    private caseLabels(c: Node): string[] {
        // Several labels can share one body (`case A: case B:` in C#/Java, `when :a, :b`).
        const labelNodes = c.namedChildren.filter((x): x is Node => !!x && /^(switch_label|case_switch_label|when_condition|switch_pattern|pattern)$/.test(x.type));
        const texts =
            labelNodes.length > 0
                ? labelNodes.map(x => x.text)
                : [c.childForFieldName('pattern')?.text ?? (c.type === 'match_arm' ? undefined : c.childForFieldName('value')?.text) ?? (c.namedChildren.find(x => x && x.type === 'expression_list') ?? null)?.text ?? c.text.split(/:(?!:)|->|=>|\bthen\b|\n/)[0]];
        if (c.type === 'match_arm' || c.childForFieldName('pattern')) {
            const pattern = c.childForFieldName('pattern')?.text;
            if (pattern && labelNodes.length === 0) texts.splice(0, texts.length, pattern);
        }
        return texts
            .flatMap(label =>
                label
                    .replace(/^\s*(case|when)\b/, '')
                    .replace(/\s*(:(?!:)|->|=>)\s*$/, '')
                    .split(/\s*[,|]\s*/)
            )
            .map(t => t.trim())
            .filter(Boolean);
    }

    private definiteWrite(ctx: Context, s: Node, v: Var): string[] | null {
        const assignment = ctx.rec.profile.assignments.includes(s.type) ? s : s.namedChildren.length === 1 && s.namedChildren[0] && ctx.rec.profile.assignments.includes(s.namedChildren[0].type) ? s.namedChildren[0] : undefined;
        if (!assignment) return null;
        const lhs = assignment.childForFieldName('left') ?? assignment.childForFieldName('lhs') ?? assignment.childForFieldName('target') ?? assignment.namedChildren[0];
        const rhs = assignment.childForFieldName('right') ?? assignment.childForFieldName('rhs') ?? assignment.childForFieldName('result') ?? lastNamed(assignment);
        if (ctx.rec.profile.id === 'go') return this.varOf(ctx, lhs?.namedChildren[0] ?? lhs) === v && rhs ? this.valuesFor(v, rhs.namedChildren[0] ?? rhs) : null;
        return this.varOf(ctx, lhs) === v && rhs ? this.valuesFor(v, rhs) : null;
    }

    /** `if (c) return;`, `return unless c`, `guard c else { return }`: the constraint after it. */
    private earlyExit(ctx: Context, s: Node, v: Var): Values {
        const p = ctx.rec.profile;
        const stmt = s.namedChildren.length === 1 && s.namedChildren[0] && p.ifs.includes(s.namedChildren[0].type) ? s.namedChildren[0] : s;
        if (!p.ifs.includes(stmt.type)) return null;
        const parts = ifParts(stmt);
        if (stmt.type === 'guard_statement') return parts.cond ? this.constraint(ctx, parts.cond, v, true) : null;
        if (!parts.cond || parts.else || !parts.then) return null;
        if (!EXIT.test(parts.then.text.replace(/^\s*\{\s*/, '').replace(/^\s*then\b/, ''))) return null;
        const flip = p.unless?.includes(stmt.type) ?? false;
        return this.constraint(ctx, parts.cond, v, flip);
    }

    private writesIn(ctx: Context, node: Node, v: Var): string[] {
        const out: string[] = [];
        for (const n of walk(node)) {
            if (!ctx.rec.profile.assignments.includes(n.type)) continue;
            const lhs = n.childForFieldName('left') ?? n.childForFieldName('lhs') ?? n.childForFieldName('target') ?? n.namedChildren[0];
            const rhs = n.childForFieldName('right') ?? n.childForFieldName('rhs') ?? n.childForFieldName('result') ?? lastNamed(n);
            if (this.varOf(ctx, lhs) === v) out.push(...((rhs && this.valuesFor(v, rhs)) ?? this.domainOf(v)));
        }
        return out;
    }

    // ------------------------------------------------------------- switches

    private switchFact(ctx: Context, sw: Node): void {
        const p = ctx.rec.profile;
        if (p.id === 'r') {
            const args = argumentsOf(sw);
            const v = this.varOf(ctx, args[0]?.value);
            if (!v) return;
            const cases = args.slice(1).filter(a => a.name).map(a => a.name!.replace(/^["'`]|["'`]$/g, ''));
            const hasDefault = args.slice(1).some(a => !a.name);
            if (!v.enumName) for (const x of cases) if (!v.fact.values.includes(x)) v.fact.values.push(x);
            for (const x of cases) this.facts.reads.push({ variable: v.fact.id, values: [x], loc: locOf(ctx.rec, sw) });
            this.facts.switches.push({ subject: args[0].value!.text, variable: v.fact.id, domain: this.domainOf(v), cases, hasDefault, loc: locOf(ctx.rec, sw), event: this.eventOf(ctx, sw) });
            return;
        }
        const subject = switchSubject(sw);
        if (!subject) return;
        const cases = this.casesOf(ctx, sw);
        const hasDefault = cases.some(isDefaultCase) || /\bdefault\s*:|\belse\s*->|\bcase\s+_\s*(=>|:)|^\s*_\s*=>/m.test(sw.text);
        const labels = cases.filter(c => !isDefaultCase(c)).flatMap(c => this.caseLabels(c));
        const v = this.varOf(ctx, subject);
        if (v) {
            const values = labels.flatMap(t => this.valuesForText(v, t) ?? []);
            if (!v.enumName) for (const x of values) if (!v.fact.values.includes(x)) v.fact.values.push(x);
            for (const x of values) this.facts.reads.push({ variable: v.fact.id, values: [x], loc: locOf(ctx.rec, sw) });
            this.facts.switches.push({ subject: subject.text, variable: v.fact.id, domain: this.domainOf(v), cases: values, hasDefault, loc: locOf(ctx.rec, sw), event: this.eventOf(ctx, sw) });
            return;
        }
        // A switch over another value whose labels are all members of one enum: a dispatch.
        this.scope(ctx.rec);
        const members = labels.map(t => constantOf(t)).filter((c): c is NonNullable<ReturnType<typeof constantOf>> => !!c && (c.kind === 'member' || c.kind === 'ident'));
        if (members.length === 0 || members.length !== labels.length) return;
        const owner = members[0].qualifier ? lastIdent(members[0].qualifier) : this.enumOfMember(members[0].value);
        const domain = owner && this.enums.get(owner);
        if (!domain || !members.every(m => domain.includes(m.value))) return;
        this.facts.switches.push({ subject: subject.text, domain, cases: members.map(m => m.value), hasDefault, loc: locOf(ctx.rec, sw), event: this.eventOf(ctx, sw) });
    }

    // ------------------------------------------------------------ finishing

    private finishVariables(): void {
        for (const v of this.vars) {
            const writes = this.facts.writes.filter(w => w.variable === v.fact.id);
            if (writes.length === 0) continue;
            if (!v.enumName) {
                const literal = new Set([...v.fact.values, ...v.initial, ...writes.flatMap(w => w.targets ?? [])]);
                v.fact.values = [...literal];
                if (v.fact.values.length < 2) continue;
            }
            v.fact.initial = [...v.initial];
            this.facts.stateVariables.push(v.fact);
        }
        const known = new Set(this.facts.stateVariables.map(v => v.id));
        for (const sw of this.facts.switches) {
            const v = this.facts.stateVariables.find(x => x.id === sw.variable);
            if (v?.inferred) sw.domain = [...v.values];
        }
        this.facts.writes = this.facts.writes.filter(w => known.has(w.variable));
        this.facts.reads = this.facts.reads.filter(r => known.has(r.variable));
        this.facts.switches = this.facts.switches.filter(s => !s.variable || known.has(s.variable));
    }

}

export const LANGUAGES = PROFILES.map(p => ({ id: p.id, name: p.name, extensions: p.extensions }));
