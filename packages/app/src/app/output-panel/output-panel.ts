import { Component, computed, inject, input, signal } from '@angular/core';
import { FRAMEWORKS, type Framework } from '@nuxmv-editor/language';
import { CodeExport } from '../code-export';
import { DiagramStore } from '../diagram-store';
import { downloadText } from '../file-io';

/** The generated nuXmv model, or the raw nuXmv console output. */
@Component({
    selector: 'app-output-panel',
    templateUrl: './output-panel.html'
})
export class OutputPanel {
    readonly store = inject(DiagramStore);
    readonly view = input<'model' | 'python' | 'console'>('model');
    readonly code = inject(CodeExport);
    readonly showBanner = signal(false);
    readonly frameworks = FRAMEWORKS;

    exportTo(select: HTMLSelectElement): void {
        const value = select.value as Framework | '';
        select.value = '';
        if (value) void this.code.downloadFramework(value);
    }
    readonly copied = signal(false);

    readonly consoleText = computed(() => {
        const v = this.store.verification();
        if (!v?.stdout && !v?.stderr) return '';
        const lines = (v.stdout ?? '').split('\n');
        const body = this.showBanner() ? lines : lines.filter(l => !l.startsWith('***'));
        return [body.join('\n').replace(/^\n+/, ''), v.stderr].filter(Boolean).join('\n--- stderr ---\n');
    });

    fileBase(): string {
        return this.store.fileName().replace(/\.nxd$/, '');
    }

    download(): void {
        downloadText(`${this.fileBase()}.smv`, this.store.generated().text);
    }

    async copy(text = this.store.generated().text): Promise<void> {
        await navigator.clipboard.writeText(text);
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 1500);
    }
}
