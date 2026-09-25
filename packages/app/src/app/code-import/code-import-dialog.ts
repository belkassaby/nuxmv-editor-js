import { Component, computed, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { downloadText } from '../file-io';
import { HelpService } from '../help-dialog/help.service';
import { CodeImport, type CodeFinding, type CodeModel } from './code-import';

type View = 'findings' | 'models' | 'patterns' | 'paradigm';
type Severity = CodeFinding['severity'];

const CATEGORY_LABELS: Record<CodeFinding['category'], string> = {
    'state-machine': 'State machines',
    lifecycle: 'Resource lifecycles',
    pattern: 'Design patterns',
    architecture: 'Architecture',
    paradigm: 'Paradigm and size'
};

/**
 * File → Import code base…: runs `pflow extract` on a folder (uploaded, or a path of the machine
 * running the server) and shows the findings; every extracted model opens in the editor.
 */
@Component({
    selector: 'app-code-import-dialog',
    templateUrl: './code-import-dialog.html'
})
export class CodeImportDialog {
    readonly codeImport = inject(CodeImport);
    readonly help = inject(HelpService);
    /** A model to open in the editor: its .pflow text and a file name. */
    readonly openModel = output<{ text: string; name: string; check: boolean }>();

    private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
    readonly path = signal('');
    readonly view = signal<View>('findings');
    readonly shown = signal<ReadonlySet<Severity>>(new Set<Severity>(['error', 'warning']));
    readonly categoryLabels = CATEGORY_LABELS;

    readonly report = this.codeImport.report;

    readonly groups = computed(() => {
        const r = this.report();
        if (!r) return [];
        const shown = this.shown();
        return (Object.keys(CATEGORY_LABELS) as Array<CodeFinding['category']>)
            .map(category => ({ category, label: CATEGORY_LABELS[category], findings: r.findings.filter(f => f.category === category && shown.has(f.severity)) }))
            .filter(g => g.findings.length > 0);
    });

    readonly properties = computed(() => this.report()?.verdicts.length ?? 0);

    /** `fresh`: start a new analysis; otherwise show the last report (kept across reloads). */
    open(fresh = false): void {
        void this.codeImport.refresh();
        if (!this.codeImport.running()) {
            if (fresh) this.codeImport.clear();
            else this.codeImport.restore();
        }
        const dialog = this.dialog().nativeElement;
        if (!dialog.open) dialog.showModal();
    }

    close(): void {
        this.dialog().nativeElement.close();
    }

    /**
     * Closes when the backdrop (the dialog element itself) is clicked. Returns nothing: an Angular
     * handler returning false cancels the event, which would stop file pickers and links inside.
     */
    backdropClick(event: MouseEvent): void {
        if (event.target === this.dialog().nativeElement) this.close();
    }

    toggle(severity: Severity): void {
        const next = new Set(this.shown());
        if (next.has(severity)) next.delete(severity);
        else next.add(severity);
        this.shown.set(next);
    }

    async analysePath(): Promise<void> {
        if (!this.path().trim()) return;
        await this.codeImport.analysePath(this.path());
        this.view.set('findings');
    }

    async analyseFolder(files: FileList | null): Promise<void> {
        await this.codeImport.analyseFolder(files);
        this.view.set('findings');
    }

    modelOf(id: string | undefined): CodeModel | undefined {
        return id ? this.report()?.models.find(m => m.id === id) : undefined;
    }

    /** Opens a model in the editor; from a finding, also checks it so the counterexample is one click away. */
    show(model: CodeModel, check = model.failed.length > 0): void {
        this.openModel.emit({ text: model.pflow, name: `${model.id}.pflow`, check });
        this.close();
    }

    where(loc: { file: string; line: number } | undefined): string {
        return loc ? `${loc.file}:${loc.line}` : '';
    }

    downloadReport(): void {
        const r = this.report();
        if (r) downloadText('provenflow-code-report.md', r.markdown, 'text/markdown');
    }

    walkthrough(): void {
        this.close();
        this.help.walkthrough('code');
    }
}
