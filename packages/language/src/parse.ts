import { EmptyFileSystem, URI, type LangiumDocument } from 'langium';
import { astToModel } from './ast-to-model.js';
import type { Diagram } from './generated/ast.js';
import type { DiagramModel } from './model.js';
import { createStateDiagramServices } from './state-diagram-module.js';

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface Diagnostic {
    severity: Severity;
    message: string;
    /** Zero based offsets into the source text. */
    from: number;
    to: number;
    line: number;
    column: number;
    source: 'lexer' | 'parser' | 'validation';
}

export interface ParseOutcome {
    model: DiagramModel;
    /** The Langium syntax tree (used by generators that need expression structure). */
    ast: Diagram;
    diagnostics: Diagnostic[];
    /** True if the text could not be parsed; `model` is then best effort. */
    hasSyntaxErrors: boolean;
    hasErrors: boolean;
}

let services: ReturnType<typeof createStateDiagramServices> | undefined;
let counter = 0;

function getServices() {
    services ??= createStateDiagramServices(EmptyFileSystem);
    return services;
}

const SEVERITIES: Record<number, Severity> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };

/** Parses and validates `.nxd` text with Langium. Works in the browser and in Node. */
export async function parseDiagram(text: string): Promise<ParseOutcome> {
    const { shared } = getServices();
    const uri = URI.parse(`memory:///diagram-${++counter}.nxd`);
    const document: LangiumDocument<Diagram> = shared.workspace.LangiumDocumentFactory.fromString<Diagram>(text, uri);
    shared.workspace.LangiumDocuments.addDocument(document);
    try {
        await shared.workspace.DocumentBuilder.build([document], { validation: true });
        const lineStarts = computeLineStarts(text);
        const diagnostics: Diagnostic[] = (document.diagnostics ?? []).map(d => {
            const from = offsetOf(lineStarts, d.range.start.line, d.range.start.character);
            const to = offsetOf(lineStarts, d.range.end.line, d.range.end.character);
            const code = typeof d.data === 'object' && d.data && 'code' in d.data ? String((d.data as { code: unknown }).code) : '';
            return {
                severity: SEVERITIES[d.severity ?? 1] ?? 'error',
                message: typeof d.message === 'string' ? d.message : d.message.value,
                from,
                to: Math.max(to, from),
                line: d.range.start.line + 1,
                column: d.range.start.character + 1,
                source: code.startsWith('lexing') ? 'lexer' : code.startsWith('parsing') ? 'parser' : 'validation'
            } satisfies Diagnostic;
        });
        const hasSyntaxErrors = document.parseResult.lexerErrors.length > 0 || document.parseResult.parserErrors.length > 0;
        return {
            model: astToModel(document.parseResult.value),
            ast: document.parseResult.value,
            diagnostics,
            hasSyntaxErrors,
            hasErrors: diagnostics.some(d => d.severity === 'error')
        };
    } finally {
        await shared.workspace.DocumentBuilder.update([], [uri]);
    }
}

function computeLineStarts(text: string): number[] {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    return starts;
}

function offsetOf(lineStarts: number[], line: number, character: number): number {
    return (lineStarts[line] ?? lineStarts[lineStarts.length - 1]) + character;
}
