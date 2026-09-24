import { Component, ElementRef, effect, inject, OnDestroy, afterNextRender, viewChild } from '@angular/core';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { DiagramStore } from '../diagram-store';
import { nxdHighlight, nxdLanguage } from './nxd-language';

/**
 * CodeMirror editor for the `.nxd` text. Parsing, validation and the
 * diagnostics shown here are provided by the Langium language services.
 */
@Component({
    selector: 'app-text-editor',
    template: `<div class="cm-host" #host></div>`,
    styles: `
        :host { display: block; height: 100%; min-height: 0; }
        .cm-host { height: 100%; }
    `
})
export class TextEditor implements OnDestroy {
    private readonly store = inject(DiagramStore);
    private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
    private view?: EditorView;

    constructor() {
        afterNextRender(() => {
            this.view = new EditorView({
                parent: this.host().nativeElement,
                state: EditorState.create({
                    doc: this.store.text(),
                    extensions: [
                        lineNumbers(),
                        history(),
                        highlightActiveLine(),
                        bracketMatching(),
                        indentOnInput(),
                        lintGutter(),
                        nxdLanguage,
                        nxdHighlight,
                        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
                        EditorView.lineWrapping,
                        EditorView.updateListener.of(update => {
                            if (update.docChanged) this.store.setText(update.state.doc.toString(), 'editor');
                        })
                    ]
                })
            });
            this.pushDiagnostics();
        });

        // Mirror text coming from the diagram (or a newly loaded file).
        effect(() => {
            const text = this.store.text();
            const view = this.view;
            if (!view || view.state.doc.toString() === text) return;
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
        });

        effect(() => {
            this.store.diagnostics();
            this.pushDiagnostics();
        });
    }

    private pushDiagnostics(): void {
        const view = this.view;
        if (!view) return;
        // Offsets are only meaningful for the text that was parsed.
        if (this.store.diagnosedText() !== view.state.doc.toString()) return;
        const length = view.state.doc.length;
        const diagnostics: CmDiagnostic[] = this.store.diagnostics().map(d => ({
            from: Math.min(d.from, length),
            to: Math.min(Math.max(d.to, d.from), length),
            severity: d.severity === 'hint' ? 'info' : d.severity,
            message: d.message,
            source: d.source === 'validation' ? 'langium' : `langium ${d.source}`
        }));
        view.dispatch(setDiagnostics(view.state, diagnostics));
    }

    /** Moves the cursor to a diagnostic (used by the problems list). */
    reveal(offset: number): void {
        const view = this.view;
        if (!view) return;
        const pos = Math.min(offset, view.state.doc.length);
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        view.focus();
    }

    ngOnDestroy(): void {
        this.view?.destroy();
    }
}
