import { Component, ElementRef, OnDestroy, afterNextRender, effect, input, untracked, viewChild } from '@angular/core';
import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';

/**
 * Original code on the left, proposed code on the right, side by side, with the changed lines
 * and characters highlighted. The right side can be edited before applying.
 */
@Component({
    selector: 'app-code-diff',
    template: `
        <div class="code-diff-heads"><span>Original</span><span>Proposed (editable)</span></div>
        <div #host class="code-diff"></div>
    `
})
export class CodeDiff implements OnDestroy {
    readonly before = input.required<string>();
    readonly after = input.required<string>();
    private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
    private view?: MergeView;

    constructor() {
        afterNextRender(() => this.create());
        // Another file or change: rebuild with its texts.
        effect(() => {
            const before = this.before();
            const after = this.after();
            untracked(() => {
                if (this.view) this.create(before, after);
            });
        });
    }

    /** The proposed text, with the edits made in the right pane. */
    current(): string {
        return this.view?.b.state.doc.toString() ?? this.after();
    }

    private create(before = this.before(), after = this.after()): void {
        this.view?.destroy();
        const common = [lineNumbers(), EditorView.lineWrapping];
        this.view = new MergeView({
            a: { doc: before, extensions: [...common, EditorState.readOnly.of(true), EditorView.editable.of(false)] },
            b: { doc: after, extensions: common },
            parent: this.host().nativeElement,
            highlightChanges: true,
            gutter: true,
            collapseUnchanged: { margin: 4, minSize: 8 }
        });
        // Show the first change.
        const first = this.view.chunks[0];
        if (first) this.view.b.dispatch({ effects: EditorView.scrollIntoView(first.fromB, { y: 'center' }) });
    }

    ngOnDestroy(): void {
        this.view?.destroy();
    }
}
