import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { HelpService } from './help.service';
import { GLOSSARY, REFERENCES, SYMBOLS } from './logic-reference';
import { WALKTHROUGHS } from './walkthroughs';
import { DiagramStore } from '../diagram-store';
import { DocumentTabs } from '../document-tabs/document-tabs';

export type HelpSection = 'guide' | 'walkthroughs' | 'symbols' | 'glossary' | 'references';

/**
 * Help window, after the two help dialogs of JungToNusmv (Appendix A), plus
 * a reference of symbolic logic notation and terms.
 */
@Component({
    selector: 'app-help-dialog',
    templateUrl: './help-dialog.html'
})
export class HelpDialog {
    private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
    readonly section = signal<HelpSection>('guide');
    readonly query = signal('');
    readonly references = REFERENCES;
    readonly sections: Array<{ id: HelpSection; label: string }> = [
        { id: 'guide', label: 'Using the editor' },
        { id: 'walkthroughs', label: 'Walkthroughs' },
        { id: 'symbols', label: 'Logic symbols' },
        { id: 'glossary', label: 'Glossary' },
        { id: 'references', label: 'References' }
    ];

    private readonly store = inject(DiagramStore);
    private readonly documents = inject(DocumentTabs);
    /** Expanded walkthroughs. */
    readonly expanded = signal<ReadonlySet<string>>(new Set());

    isOpen(id: string): boolean {
        return this.expanded().has(id) || this.query().trim() !== '';
    }

    toggle(id: string): void {
        const next = new Set(this.expanded());
        if (next.has(id)) next.delete(id);
        else next.add(id);
        this.expanded.set(next);
    }

    readonly walkthroughs = computed(() => {
        const q = this.query().trim().toLowerCase();
        return WALKTHROUGHS.filter(w => !q || [w.title, w.goal, w.keywords ?? '', ...w.steps.map(s => s.text + (s.code ?? ''))].some(t => t.toLowerCase().includes(q)));
    });

    readonly symbols = computed(() => {
        const q = this.query().trim().toLowerCase();
        return SYMBOLS.filter(s => !q || [s.symbol, s.syntax, s.name, s.meaning, s.logic].some(t => t.toLowerCase().includes(q)));
    });

    readonly symbolGroups = computed(() =>
        (['Propositional', 'LTL', 'CTL', 'Meta'] as const)
            .map(logic => ({ logic, items: this.symbols().filter(s => s.logic === logic) }))
            .filter(g => g.items.length > 0)
    );

    readonly glossary = computed(() => {
        const q = this.query().trim().toLowerCase();
        return GLOSSARY.filter(g => !q || [g.term, g.aka ?? '', g.definition, g.example ?? ''].some(t => t.toLowerCase().includes(q)));
    });

    readonly groupTitles: Record<string, string> = {
        Propositional: 'Propositional connectives',
        LTL: 'LTL — linear time operators (one path)',
        CTL: 'CTL — branching time operators (tree of paths)',
        Meta: 'Notation used to talk about models'
    };

    constructor() {
        inject(HelpService).dialog = this;
    }

    open(section: HelpSection = 'guide', focus: string | null = null): void {
        this.section.set(section);
        this.query.set('');
        if (focus) this.expanded.set(new Set([focus]));
        const dialog = this.dialog().nativeElement;
        if (!dialog.open) dialog.showModal();
        if (focus) setTimeout(() => dialog.querySelector(`#walkthrough-${focus}`)?.scrollIntoView({ block: 'start' }), 50);
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

    loadExample(id: string): void {
        this.documents.openExample(id);
        this.close();
    }

    show(section: HelpSection): void {
        this.section.set(section);
    }
}
