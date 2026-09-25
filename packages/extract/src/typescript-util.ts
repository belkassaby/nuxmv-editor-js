/** Helpers shared by the TypeScript front end modules. */
import { relative } from 'node:path';
import ts from 'typescript';

export const COMPILER_OPTIONS: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: ['node'],
    skipLibCheck: true,
    jsx: ts.JsxEmit.Preserve,
    experimentalDecorators: false
};

/** Methods synthesized from Angular templates start with this prefix. */
export const TEMPLATE_PREFIX = '__pflow_tpl_';

export function rel(root: string, sf: ts.SourceFile): string {
    return relative(root, sf.fileName).split('\\').join('/');
}

export function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
    return (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessor(node) ||
        ts.isSetAccessor(node)
    );
}

export function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
    return ts.findAncestor(node.parent, isFunctionLike) as ts.FunctionLikeDeclaration | undefined;
}

/** The nearest function with a name of its own (callbacks belong to the method creating them). */
export function enclosingNamedFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
    let fn = enclosingFunction(node);
    while (fn && memberName(fn) === 'anonymous') fn = enclosingFunction(fn);
    return fn;
}

export function memberName(fn: ts.FunctionLikeDeclaration): string {
    if (ts.isConstructorDeclaration(fn)) return 'constructor';
    if (fn.name) return fn.name.getText();
    const parent = fn.parent;
    if ((ts.isPropertyDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) && parent.name) return parent.name.getText();
    return 'anonymous';
}

/** `Class.method`, or `Class.method (callback)` for functions created inside a method. */
export function eventName(fn: ts.FunctionLikeDeclaration): string {
    const named = memberName(fn) === 'anonymous' ? enclosingNamedFunction(fn) : fn;
    const base = named ? memberName(named) : 'callback';
    const cls = ts.findAncestor(fn, ts.isClassDeclaration);
    const qualified = cls?.name ? `${cls.name.text}.${base}` : base;
    return named === fn ? qualified : `${qualified} (callback)`;
}

export function skipParens(e: ts.Expression): ts.Expression {
    let r = e;
    while (ts.isParenthesizedExpression(r) || ts.isAsExpression(r) || ts.isSatisfiesExpression(r) || ts.isNonNullExpression(r)) r = r.expression;
    return r;
}

export function escape(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
