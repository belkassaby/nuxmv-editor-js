/** Resources that must be given back (timers, listeners, EventSources, processes, temp dirs), as acquire/release facts. */
import ts from 'typescript';
import type { ResourceKind } from './ir.js';
import type { SourceContext } from './typescript-context.js';
import { enclosingFunction, enclosingNamedFunction, escape, isFunctionLike, memberName } from './typescript-util.js';

export class ResourceFacts {
    constructor(private readonly ctx: SourceContext) {}

        visit(node: ts.Node): void {
        let kind: ResourceKind | undefined;
        let op: 'acquire' | 'release' | undefined;
        let handle: string | undefined;
        let global = false;
        let anonymous = false;
        let selfReleasing = false;
        const text = (n: ts.Node) => n.getText(this.ctx.sf);
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
            const receiver = ts.isPropertyAccessExpression(callee) ? callee.expression : undefined;
            const receiverText = receiver ? text(receiver) : '';
            if (name === 'setInterval' && !receiver) [kind, op] = ['interval', 'acquire'];
            else if (name === 'clearInterval') [kind, op, handle] = ['interval', 'release', node.arguments[0] && text(node.arguments[0])];
            else if (name === 'setTimeout' && !receiver && this.storedHandle(node)?.startsWith('this.')) [kind, op] = ['timeout', 'acquire'];
            else if (name === 'clearTimeout') [kind, op, handle] = ['timeout', 'release', node.arguments[0] && text(node.arguments[0])];
            else if ((name === 'addEventListener' || name === 'on' || name === 'addListener') && receiver && isLongLived(receiverText)) {
                [kind, op] = ['listener', 'acquire'];
                global = /^(window|document|globalThis|process)\b/.test(receiverText);
                const fn = node.arguments[1];
                anonymous = !!fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn));
                handle = `${receiverText}:${node.arguments[0] ? text(node.arguments[0]) : ''}`;
                // Listening for the end of a child process is how it is released.
                if (name === 'on' && /['"](close|exit)['"]/.test(node.arguments[0]?.getText(this.ctx.sf) ?? '') && this.isProcessHandle(receiverText)) {
                    [kind, op, handle] = ['process', 'release', receiverText];
                }
            } else if ((name === 'removeEventListener' || name === 'off' || name === 'removeListener') && receiver && isLongLived(receiverText)) {
                [kind, op, handle] = ['listener', 'release', `${receiverText}:${node.arguments[0] ? text(node.arguments[0]) : ''}`];
                global = /^(window|document|globalThis|process)\b/.test(receiverText);
            } else if (name === 'subscribe' && receiver) {
                [kind, op] = ['subscription', 'acquire'];
                selfReleasing = /takeUntilDestroyed|takeUntil|take\(1\)|first\(\)/.test(receiverText);
            } else if (name === 'unsubscribe' && receiver) [kind, op, handle] = ['subscription', 'release', receiverText];
            else if (name === 'mkdtemp' || name === 'mkdtempSync') [kind, op] = ['temp-dir', 'acquire'];
            else if ((name === 'rm' || name === 'rmSync' || name === 'rmdir') && node.arguments[0]) [kind, op, handle] = ['temp-dir', 'release', text(node.arguments[0])];
            else if ((name === 'spawn' || name === 'fork') && !receiver) [kind, op] = ['process', 'acquire'];
            else if (name === 'kill' && receiver) [kind, op, handle] = ['process', 'release', receiverText];
            else if (name === 'cytoscape' && !receiver) [kind, op] = ['graph', 'acquire'];
            // this.close()/this.destroy() call the class's own methods (followed through the call graph instead).
            else if (receiver?.kind === ts.SyntaxKind.ThisKeyword) return;
            else if (name === 'destroy' && receiver && node.arguments.length === 0) [kind, op, handle] = ['graph', 'release', receiverText];
            else if (name === 'close' && receiver && node.arguments.length === 0) [kind, op, handle] = [undefined, 'release', receiverText];
            else if (name === 'disconnect' && receiver && node.arguments.length === 0) [kind, op, handle] = ['observer', 'release', receiverText];
        } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
            const cls = node.expression.text;
            if (cls === 'EventSource' || cls === 'WebSocket') [kind, op] = ['event-source', 'acquire'];
            else if (/^(Resize|Mutation|Intersection|Performance)Observer$/.test(cls)) [kind, op] = ['observer', 'acquire'];
        }
        if (!op) return;
        if (op === 'acquire' && !handle) handle = this.storedHandle(node);
        if (!kind) {
            // `.close()`: releases whatever was acquired into that handle (EventSource, file, server).
            kind = this.kindOfHandle(node, handle);
            if (!kind) return;
        }
        const owner = this.owner(node);
        if (!owner) return;
        this.ctx.facts.resources.push({
            kind,
            op,
            owner: owner.id,
            ownerKind: owner.kind,
            member: owner.member,
            loc: this.ctx.loc(node),
            handle,
            // Waiting for a child's close/exit event runs however the process ends.
            guaranteed: op === 'release' && (isInFinally(node) || kind === 'process'),
            global: global || undefined,
            anonymous: anonymous || undefined,
            selfReleasing: selfReleasing || undefined,
            guarded: (op === 'acquire' && handle && this.guardedAcquire(node, handle)) || undefined,
            text: this.ctx.lineText(node)
        });
    }

    /** `if (this.timer) return;` (or `if (!this.timer) { ... }`) before the acquisition in its function. */
    private guardedAcquire(node: ts.Node, handle: string): boolean {
        const fn = enclosingNamedFunction(node);
        if (!fn?.body) return false;
        const before = this.ctx.sf.text.slice(fn.body.getStart(this.ctx.sf), node.getStart(this.ctx.sf));
        const h = escape(handle.replace(/:.*$/, ''));
        return new RegExp(`if\\s*\\(\\s*${h}\\s*(!==?\\s*(undefined|null)\\s*)?\\)\\s*(return|\\{\\s*return)`).test(before) || new RegExp(`if\\s*\\(\\s*!\\s*${h}\\s*\\)`).test(before);
    }

    /** The variable or field a resource handle is stored in: `this.timer = setInterval(...)`, `const dir = await mkdtemp(...)`. */
    private storedHandle(node: ts.Node): string | undefined {
        let e: ts.Node = node;
        while (e.parent && (ts.isAwaitExpression(e.parent) || ts.isParenthesizedExpression(e.parent) || ts.isAsExpression(e.parent))) e = e.parent;
        const parent = e.parent;
        if (parent && ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === e) return parent.left.getText(this.ctx.sf);
        if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
            // const source = new EventSource(...); this.source = source;
            const local = parent.name.text;
            const fn = enclosingNamedFunction(node);
            const field = fn?.body && new RegExp(`this\\.(\\w+)\\s*=\\s*${escape(local)}\\s*;`).exec(fn.body.getText(this.ctx.sf));
            return field ? `this.${field[1]}` : local;
        }
        if (parent && ts.isPropertyDeclaration(parent)) return `this.${parent.name.getText(this.ctx.sf)}`;
        return undefined;
    }

    private isProcessHandle(handle: string): boolean {
        return this.ctx.facts.resources.some(r => r.kind === 'process' && r.op === 'acquire' && r.handle === handle && r.loc.file === this.ctx.file);
    }

    private kindOfHandle(node: ts.Node, handle: string | undefined): ResourceKind | undefined {
        if (!handle) return undefined;
        const owner = this.owner(node);
        const acquired = this.ctx.facts.resources.find(r => r.op === 'acquire' && r.handle === handle && r.owner === owner?.id);
        if (acquired) return acquired.kind;
        // The acquisition may come later in the file (e.g. close() declared before connect()).
        const cls = ts.findAncestor(node, ts.isClassDeclaration);
        if (cls && new RegExp(`${escape(handle)}\\s*=\\s*new\\s+(EventSource|WebSocket)`).test(cls.getText(this.ctx.sf))) return 'event-source';
        return undefined;
    }

    private owner(node: ts.Node): { id: string; kind: 'class' | 'function'; member: string } | undefined {
        const fn = enclosingNamedFunction(node);
        const cls = ts.findAncestor(node, ts.isClassDeclaration);
        const member = onDestroyCallback(node) ? 'ngOnDestroy' : fn ? memberName(fn) : 'module';
        if (cls?.name) return { id: `${this.ctx.file}#${cls.name.text}`, kind: 'class', member };
        if (fn) return { id: `${this.ctx.file}#${memberName(fn)}`, kind: 'function', member };
        return undefined;
    }

}

function onDestroyCallback(node: ts.Node): boolean {
    let fn = enclosingFunction(node);
    while (fn) {
        const call = fn.parent;
        if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'onDestroy') return true;
        if (memberName(fn) !== 'anonymous') return false;
        fn = enclosingFunction(fn);
    }
    return false;
}

function isInFinally(node: ts.Node): boolean {
    let current: ts.Node = node;
    while (current.parent && !isFunctionLike(current)) {
        if (ts.isTryStatement(current.parent) && current.parent.finallyBlock === current) return true;
        current = current.parent;
    }
    return false;
}

/** Event targets that outlive the code registering on them. */
function isLongLived(receiver: string): boolean {
    return /^(window|document|globalThis|process)\b/.test(receiver) || /^this\.\w+$/.test(receiver) || /matchMedia\(/.test(receiver);
}
