import { Component, computed, inject, input, signal } from '@angular/core';
import { DiagramStore } from '../diagram-store';
import { downloadText } from '../file-io';

/** The generated nuXmv model, or the raw nuXmv console output. */
@Component({
    selector: 'app-output-panel',
    templateUrl: './output-panel.html'
})
export class OutputPanel {
    readonly store = inject(DiagramStore);
    readonly view = input<'model' | 'console'>('model');
    readonly showBanner = signal(false);
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

    async copy(): Promise<void> {
        await navigator.clipboard.writeText(this.store.generated().text);
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 1500);
    }
}
