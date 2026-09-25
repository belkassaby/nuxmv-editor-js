/** Acquisitions and releases of resources in the tree-sitter languages. */
import type { Node } from 'web-tree-sitter';
import type { ResourceOpFact } from '../ir.js';
import type { Context } from './records.js';
import { ancestorOf, argumentsOf, calleeOf, escape, IMPLICIT_THIS, lastNamed, lineOf, locOf, NO_EXCEPTIONS, normaliseHandle } from './syntax.js';


export function resourceOp(ctx: Context, call: Node, previous: ResourceOpFact[]): ResourceOpFact | undefined {
    const p = ctx.rec.profile;
    const callee = calleeOf(call);
    if (!callee) return undefined;
    for (const rule of p.resources) {
        let op: 'acquire' | 'release' | undefined;
        if (rule.acquire.test(callee)) op = 'acquire';
        else if (rule.release.test(callee)) op = 'release';
        if (!op) continue;
        if (op === 'acquire' && rule.acquire.source === rule.release.source && /LOCK_UN/.test(call.text)) op = 'release';
        // R: sink() without arguments ends the diversion.
        if (op === 'acquire' && p.id === 'r' && callee === 'sink' && argumentsOf(call).length === 0) op = 'release';
        // Ruby: File.open(...) { |f| ... } closes the file when the block ends.
        if (op === 'acquire' && p.id === 'ruby' && call.namedChildren.some(c => c && (c.type === 'block' || c.type === 'do_block'))) return undefined;
        // Released automatically: try-with-resources, using, with, `.use {}`.
        if (op === 'acquire' && (ancestorOf(call, ['resource_specification', 'using_statement', 'with_statement']) || /^\s*\.\s*use\s*\{/.test(ctx.rec.text.slice(call.endIndex, call.endIndex + 12)))) return undefined;
        let handle: string | undefined;
        if (op === 'acquire') handle = storedHandle(ctx, call);
        else handle = rule.releaseHandle === 'receiver' ? callee.replace(/\.\w+$/, '') : argumentsOf(call)[0]?.value?.text ?? (call.type === 'delete_expression' ? lastNamed(call)?.text : undefined);
        if (handle) handle = normaliseHandle(p, handle, ctx.method?.receiver);
        if (handle && /^\w+$/.test(handle) && ctx.cls?.fields.has(handle) && IMPLICIT_THIS.has(p.id)) handle = `this.${handle}`;
        let guaranteed = op === 'release' && (!!ancestorOf(call, p.guarded) || (p.id === 'r' && /on\.exit\s*\(/.test(ancestorOf(call, ['call'])?.parent?.text ?? '')));
        if (op === 'release' && !guaranteed && NO_EXCEPTIONS.has(p.id) && handle && ctx.method?.body) {
            // Without exceptions, the release is skipped only by a return between the acquisition and it
            // (returns that test the handle itself, e.g. `if (p == NULL) return`, do not count).
            const acquired = [...previous].reverse().find(x => x.op === 'acquire' && x.handle === handle && x.member === (ctx.method?.name ?? ''));
            if (acquired) {
                const lines = ctx.rec.text.split('\n');
                const start = acquired.loc.line; // index of the line after the acquisition
                const between = lines.slice(start, call.startPosition.row);
                const check = new RegExp(`\\b(${escape(handle)}|err|error|NULL|nil|null)\\b`);
                guaranteed = !between.some((l, i) => {
                    if (!/\breturn\b/.test(l)) return false;
                    // The failure check right after the acquisition (`if (p == NULL) return`, `if err != nil { return }`).
                    for (let j = i; j >= Math.max(0, i - 1); j--) if (/\bif\b/.test(between[j]) && check.test(between[j]) && j <= 1) return false;
                    return true;
                });
            }
        }
        const owner = ctx.cls ? { id: ctx.cls.id, kind: 'class' as const } : { id: `${ctx.rec.file}#${ctx.method?.name ?? 'module'}`, kind: 'function' as const };
        const fact: ResourceOpFact = {
            kind: rule.kind,
            op,
            owner: owner.id,
            ownerKind: owner.kind,
            member: ctx.method?.ctor ? 'constructor' : ctx.method?.name ?? 'module',
            loc: locOf(ctx.rec, call),
            handle,
            guaranteed,
            text: lineOf(ctx.rec, call)
        };
        if (op === 'acquire' && handle && ctx.method?.body) {
            const before = ctx.rec.text.slice(ctx.method.body.startIndex, call.startIndex);
            const h = escape(handle.replace(/^this\./, ''));
            if (new RegExp(`if\\s*\\(?\\s*!?\\s*(?:this\\.|self\\.|\\$this->|@)?${h}\\b[^\\n]*\\)?\\s*[{]?\\s*(return|throw)`).test(before)) fact.guarded = true;
        }
        return fact;
    }
    return undefined;
}

function storedHandle(ctx: Context, call: Node): string | undefined {
    let n: Node | null = call.parent;
    for (let i = 0; n && i < 4; i++, n = n.parent) {
        if (/assignment|variable_declarator|init_declarator|let_declaration|short_var_declaration|property_declaration|local_variable_declaration|binary_operator|variable_declaration/.test(n.type)) {
            const lhs = n.childForFieldName('left') ?? n.childForFieldName('lhs') ?? n.childForFieldName('name') ?? n.childForFieldName('pattern') ?? n.childForFieldName('declarator') ?? n.namedChildren[0];
            if (!lhs || lhs.id === call.id) return undefined;
            const text = ctx.rec.profile.id === 'go' ? (lhs.namedChildren[0] ?? lhs).text : lhs.text;
            return text.replace(/^\*+/, '').trim();
        }
    }
    return undefined;
}
