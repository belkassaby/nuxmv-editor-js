/** The file being visited, and where facts found in it are reported (template bindings map back to the template). */
import { resolve } from 'node:path';
import ts from 'typescript';
import type { Facts, Location } from './ir.js';
import { isTestFile } from './scan.js';
import type { TemplateHandler } from './typescript-templates.js';
import { rel, TEMPLATE_PREFIX } from './typescript-util.js';

export class SourceContext {
    sf!: ts.SourceFile;
    file = '';
    test = false;

    constructor(
        readonly root: string,
        readonly checker: ts.TypeChecker,
        readonly facts: Facts,
        private readonly handlers: Map<string, TemplateHandler>
    ) {}

    enter(sf: ts.SourceFile): void {
        this.sf = sf;
        this.file = rel(this.root, sf);
        this.test = isTestFile(this.file);
    }

    /** The template binding a synthesized method stands for. */
    handlerOf(node: ts.Node): TemplateHandler | undefined {
        if (this.handlers.size === 0) return undefined;
        const method = ts.findAncestor(node, n => ts.isMethodDeclaration(n) && n.name.getText().startsWith(TEMPLATE_PREFIX)) as ts.MethodDeclaration | undefined;
        return method ? this.handlers.get(`${resolve(this.sf.fileName)}#${method.name.getText()}`) : undefined;
    }

    loc(node: ts.Node): Location {
        const handler = this.handlerOf(node);
        if (handler) return handler.loc;
        return { file: this.file, line: this.sf.getLineAndCharacterOfPosition(node.getStart(this.sf)).line + 1 };
    }

    lineText(node: ts.Node): string {
        const handler = this.handlerOf(node);
        if (handler) return handler.text;
        const line = this.sf.getLineAndCharacterOfPosition(node.getStart(this.sf)).line;
        const starts = this.sf.getLineStarts();
        return this.sf.text.slice(starts[line], starts[line + 1] ?? this.sf.text.length).trim();
    }
}
