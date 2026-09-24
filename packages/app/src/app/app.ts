import { Component, computed, effect, HostListener, inject, OnInit, signal, viewChild } from '@angular/core';
import { EXAMPLES } from '@nuxmv-editor/language';
import { AttributeTable } from './attribute-table/attribute-table';
import { DiagramCanvas } from './diagram-canvas/diagram-canvas';
import { DiagramStore } from './diagram-store';
import { downloadText, pickFile } from './file-io';
import { HelpDialog, type HelpSection } from './help-dialog/help-dialog';
import { Inspector } from './inspector/inspector';
import { NuxmvApi } from './nuxmv-api';
import { OutputPanel } from './output-panel/output-panel';
import { ProblemsList } from './problems-list/problems-list';
import { PropertiesPanel } from './properties-panel/properties-panel';
import { TextEditor } from './text-editor/text-editor';
import { TracePanel } from './trace-panel/trace-panel';

type Tab = 'attributes' | 'properties' | 'trace' | 'model' | 'console';

@Component({
    selector: 'app-root',
    imports: [AttributeTable, DiagramCanvas, HelpDialog, Inspector, OutputPanel, ProblemsList, PropertiesPanel, TextEditor, TracePanel],
    templateUrl: './app.html',
    styleUrl: './app.css'
})
export class App implements OnInit {
    readonly store = inject(DiagramStore);
    readonly api = inject(NuxmvApi);
    readonly exampleGroups = [...new Set(EXAMPLES.map(e => e.group))].map(name => ({ name, examples: EXAMPLES.filter(e => e.group === name) }));
    readonly tab = signal<Tab>('properties');
    readonly openMenu = signal<string | null>(null);
    readonly showText = signal(true);
    readonly message = signal<string | null>(null);
    private readonly editor = viewChild(TextEditor);
    private readonly canvas = viewChild(DiagramCanvas);
    private readonly help = viewChild.required(HelpDialog);

    readonly tabs = computed(() => {
        const v = this.store.verification();
        const failed = v?.results.filter(r => r?.verdict === 'false').length ?? 0;
        return [
            { id: 'attributes' as Tab, label: `Attributes (${this.store.model().attributes.length})` },
            { id: 'properties' as Tab, label: `Properties (${this.store.model().specs.length})`, badge: failed > 0 ? `${failed} ✗` : undefined },
            { id: 'trace' as Tab, label: this.store.simulation() ? 'Simulation' : 'Trace', dot: !!this.store.highlight() },
            { id: 'model' as Tab, label: 'nuXmv model' },
            { id: 'console' as Tab, label: 'nuXmv output' }
        ];
    });

    constructor() {
        // Opening a counterexample or starting a simulation brings its panel to the front.
        effect(() => {
            if (this.store.trace() || this.store.simulation()) this.tab.set('trace');
        });
    }

    ngOnInit(): void {
        void this.api.refreshStatus();
    }

    toggleMenu(name: string, event: Event): void {
        event.stopPropagation();
        this.openMenu.set(this.openMenu() === name ? null : name);
    }

    @HostListener('document:click')
    closeMenus(): void {
        this.openMenu.set(null);
    }

    @HostListener('document:keydown', ['$event'])
    onKey(event: KeyboardEvent): void {
        const target = event.target as HTMLElement;
        const typing = target.closest('input, textarea, select, .cm-editor, [contenteditable]');
        if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && this.store.selection()) {
            event.preventDefault();
            this.store.deleteSelection();
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 's') {
            event.preventDefault();
            this.save();
        }
        if (event.key === 'Escape') {
            this.openMenu.set(null);
            if (!typing) this.store.selection.set(null);
        }
    }

    @HostListener('window:beforeunload', ['$event'])
    beforeUnload(event: BeforeUnloadEvent): void {
        if (this.store.dirty()) event.preventDefault();
    }

    // ------------------------------------------------------------ File menu

    newDiagram(): void {
        if (this.confirmDiscard()) this.store.newDiagram();
    }

    async open(): Promise<void> {
        if (!this.confirmDiscard()) return;
        const file = await pickFile('.nxd,.txt');
        if (file) this.store.load(file.text, file.name);
    }

    save(): void {
        downloadText(this.store.fileName(), this.store.text());
        this.store.dirty.set(false);
        this.flash(`Saved ${this.store.fileName()}`);
    }

    exportSmv(): void {
        const g = this.store.generated();
        if (g.error) return this.flash(g.error);
        downloadText(this.store.fileName().replace(/\.nxd$/, '') + '.smv', g.text);
    }

    exportPng(): void {
        this.canvas()?.exportPng();
    }

    loadExample(id: string): void {
        if (this.confirmDiscard()) this.store.loadExample(id);
    }

    // ----------------------------------------------------------- nuXmv menu

    async check(): Promise<void> {
        this.tab.set('properties');
        await this.api.verify();
        const v = this.store.verification();
        const firstTrace = v?.results.findIndex(r => r?.trace) ?? -1;
        if (v?.requestError || (v?.errors.length ?? 0) > 0) this.tab.set('console');
        else if (firstTrace >= 0) this.flash('Some properties are false: open a counterexample to replay it on the diagram.');
    }

    showTrace(): void {
        this.tab.set('trace');
    }

    simulate(): void {
        this.store.startSimulation();
        this.tab.set('trace');
    }

    openHelp(section: HelpSection = 'guide'): void {
        this.help().open(section);
    }

    reveal(offset: number): void {
        this.showText.set(true);
        setTimeout(() => this.editor()?.reveal(offset));
    }

    private confirmDiscard(): boolean {
        return !this.store.dirty() || confirm('Discard the changes to the current diagram?');
    }

    private flash(text: string): void {
        this.message.set(text);
        setTimeout(() => this.message() === text && this.message.set(null), 4000);
    }
}
