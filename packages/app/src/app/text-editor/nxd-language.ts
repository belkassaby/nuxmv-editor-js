import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const KEYWORDS = new Set(['diagram', 'attributes', 'state', 'initial', 'at', 'boolean', 'NAME', 'mod', 'xor', 'xnor']);
const SECTIONS = new Set(['LTLSPEC', 'CTLSPEC', 'INVARSPEC', 'FAIRNESS', 'JUSTICE']);
const TEMPORAL = new Set(['G', 'F', 'X', 'U', 'V', 'Y', 'Z', 'H', 'O', 'S', 'T', 'A', 'E', 'AG', 'AF', 'AX', 'EG', 'EF', 'EX']);
const CONSTANTS = new Set(['TRUE', 'FALSE']);

/** Syntax highlighting for `.nxd`; structure and errors come from Langium. */
export const nxdLanguage = StreamLanguage.define<{ inComment: boolean }>({
    name: 'nxd',
    startState: () => ({ inComment: false }),
    token(stream, state) {
        if (state.inComment) {
            if (stream.skipTo('*/')) {
                stream.match('*/');
                state.inComment = false;
            } else stream.skipToEnd();
            return 'comment';
        }
        if (stream.eatSpace()) return null;
        if (stream.match('/*')) {
            state.inComment = true;
            return 'comment';
        }
        if (stream.match('//') || stream.match('--')) {
            stream.skipToEnd();
            return 'comment';
        }
        if (stream.match(/^"(?:\\.|[^"\\])*"?/)) return 'string';
        if (stream.match(/^\d+/)) return 'number';
        if (stream.match(/^(->|<->|!=|<=|>=|:=|\.\.|[=<>!&|+\-*/:;,{}()[\]])/)) return 'operator';
        const word = stream.match(/^[_a-zA-Z][\w$#]*/) as RegExpMatchArray | null;
        if (word) {
            const w = word[0];
            if (SECTIONS.has(w)) return 'heading';
            if (KEYWORDS.has(w)) return 'keyword';
            if (TEMPORAL.has(w)) return 'macroName';
            if (CONSTANTS.has(w)) return 'atom';
            return 'variableName';
        }
        stream.next();
        return null;
    },
    languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } }
});

export const nxdHighlight = syntaxHighlighting(
    HighlightStyle.define([
        { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
        { tag: tags.keyword, color: 'var(--syntax-keyword)', fontWeight: '600' },
        { tag: tags.heading, color: 'var(--syntax-section)', fontWeight: '700' },
        { tag: tags.macroName, color: 'var(--syntax-temporal)', fontWeight: '600' },
        { tag: tags.atom, color: 'var(--syntax-constant)' },
        { tag: tags.number, color: 'var(--syntax-constant)' },
        { tag: tags.string, color: 'var(--syntax-string)' },
        { tag: tags.operator, color: 'var(--syntax-operator)' },
        { tag: tags.variableName, color: 'var(--text)' }
    ])
);
