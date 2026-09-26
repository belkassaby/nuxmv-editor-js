import { Component, computed, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { CodeDiff } from './code-diff';
import { downloadText } from '../file-io';
import { HelpService } from '../help-dialog/help.service';
import { CodeImport, type CodeFinding, type CodeModel } from './code-import';

type View = 'findings' | 'changes' | 'change' | 'models' | 'patterns' | 'paradigm';
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
    imports: [CodeDiff],
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

    /** Findings with a proposed code change. */
    readonly changes = computed(() => (this.report()?.findings ?? []).filter(f => f.suggestedPatch?.files?.length));
    /** The change being reviewed, and which of its files. */
    readonly reviewing = signal<CodeFinding | null>(null);
    readonly fileIndex = signal(0);
    readonly applyMessage = signal<{ ok: boolean; text: string } | null>(null);
    private readonly diff = viewChild(CodeDiff);
    private back: View = 'findings';

    review(f: CodeFinding): void {
        this.back = this.view() === 'change' ? this.back : this.view();
        this.reviewing.set(f);
        this.fileIndex.set(0);
        this.applyMessage.set(null);
        this.view.set('change');
    }

    closeReview(): void {
        this.view.set(this.back);
        this.reviewing.set(null);
    }

    /** Applies the right-hand text (with any edits) to the file in the analysed folder. */
    async applyChange(): Promise<void> {
        const f = this.reviewing();
        const file = f?.suggestedPatch?.files?.[this.fileIndex()];
        if (!file) return;
        const error = await this.codeImport.apply(file.file, file.before, this.diff()?.current() ?? file.after);
        this.applyMessage.set(error ? { ok: false, text: error } : { ok: true, text: `Applied to ${file.file}. Run the analysis again to check the whole project with the change.` });
    }

    downloadChange(): void {
        const file = this.reviewing()?.suggestedPatch?.files?.[this.fileIndex()];
        if (file) downloadText(file.file.split('/').pop()!, this.diff()?.current() ?? file.after);
    }

    async copyChange(): Promise<void> {
        const file = this.reviewing()?.suggestedPatch?.files?.[this.fileIndex()];
        if (!file) return;
        await navigator.clipboard.writeText(this.diff()?.current() ?? file.after);
        this.applyMessage.set({ ok: true, text: 'Copied to the clipboard.' });
    }

    /** Analyses the same folder again (after applying changes). */
    async rerun(): Promise<void> {
        const r = this.report();
        if (!r?.applicable) return;
        this.path.set(r.root);
        await this.analysePath();
    }

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
