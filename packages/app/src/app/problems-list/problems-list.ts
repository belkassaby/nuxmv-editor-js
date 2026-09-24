import { Component, inject, output } from '@angular/core';
import { DiagramStore } from '../diagram-store';

/** Langium diagnostics of the `.nxd` text. */
@Component({
    selector: 'app-problems-list',
    template: `
        @if (store.diagnostics().length === 0) {
            <p class="muted small pad-x ok-text">✓ No problems</p>
        } @else {
            <ul class="problems">
                @for (d of store.diagnostics(); track $index) {
                    <li>
                        <button type="button" class="problem" [class]="d.severity" (click)="reveal.emit(d.from)">
                            <span class="sev">{{ d.severity }}</span>
                            <span class="loc">{{ d.line }}:{{ d.column }}</span>
                            <span class="msg">{{ d.message }}</span>
                        </button>
                    </li>
                }
            </ul>
        }
    `
})
export class ProblemsList {
    readonly store = inject(DiagramStore);
    readonly reveal = output<number>();
}
