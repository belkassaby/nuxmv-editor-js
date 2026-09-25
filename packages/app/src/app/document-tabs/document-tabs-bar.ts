import { Component, inject, output } from '@angular/core';
import { CodeImport } from '../code-import/code-import';
import { DocumentTabs, type DocumentKind } from './document-tabs';

const ICONS: Record<DocumentKind, string> = { file: '▤', example: '★', new: '＋', code: '⌘', import: '⇪' };
const TITLES: Record<DocumentKind, string> = {
    file: 'Opened from a file',
    example: 'Example',
    new: 'New diagram',
    code: 'Model found by Import code base',
    import: 'Imported agent graph'
};

/** One tab per open document, plus the way back to the last code-base report. */
@Component({
    selector: 'app-document-tabs',
    template: `
        <nav class="doc-tabs" aria-label="Open documents">
            <div class="doc-tab-list" role="tablist">
                @for (t of tabs.tabs(); track t.id) {
                    <div class="doc-tab" role="tab" [class.active]="t.id === tabs.active()" [attr.aria-selected]="t.id === tabs.active()" [title]="titles[t.kind] + ': ' + t.fileName" (click)="tabs.activate(t.id)" (auxclick)="middleClick($event, t.id)">
                        <span class="doc-icon" aria-hidden="true">{{ icons[t.kind] }}</span>
                        <span class="doc-name">{{ t.fileName }}</span>
                        @if (t.dirty) { <span class="doc-dirty" title="Unsaved changes">●</span> }
                        <button type="button" class="doc-close" (click)="$event.stopPropagation(); tabs.close(t.id)" [attr.aria-label]="'Close ' + t.fileName">×</button>
                    </div>
                }
                <button type="button" class="doc-new" (click)="tabs.newDiagram()" title="New diagram" aria-label="New diagram">+</button>
            </div>
            @if (codeImport.report(); as r) {
                <button type="button" class="doc-report" (click)="showReport.emit()" [title]="'Findings and models of ' + r.root + ' (' + r.models.length + ' models)'">
                    ⌘ Code report: {{ r.root }} <span class="badge warn">{{ r.summary.error + r.summary.warning }}</span>
                </button>
            }
        </nav>
    `
})
export class DocumentTabsBar {
    readonly tabs = inject(DocumentTabs);
    readonly codeImport = inject(CodeImport);
    readonly showReport = output<void>();
    readonly icons = ICONS;
    readonly titles = TITLES;

    /** Middle click closes a tab, as in browsers (no return value: returning false would cancel the event). */
    middleClick(event: MouseEvent, id: number): void {
        if (event.button === 1) this.tabs.close(id);
    }
}
