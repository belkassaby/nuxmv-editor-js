import { effect, Injectable, inject, signal } from '@angular/core';
import { exportToFramework, generateNotebook, generatePython, generatePythonTests, type Framework, type GeneratedPython } from '@nuxmv-editor/language';
import { DiagramStore } from './diagram-store';
import { downloadText } from './file-io';

/** Python / Jupyter generation for the current diagram. */
@Injectable({ providedIn: 'root' })
export class CodeExport {
    private readonly store = inject(DiagramStore);
    readonly python = signal<GeneratedPython | null>(null);
    readonly error = signal<string | null>(null);
    private timer: ReturnType<typeof setTimeout> | undefined;
    private generation = 0;

    constructor() {
        // Regenerate shortly after the diagram changes (the generator re-parses the model).
        effect(() => {
            const model = this.store.model();
            clearTimeout(this.timer);
            const run = ++this.generation;
            this.timer = setTimeout(async () => {
                try {
                    const py = model.states.length > 0 ? await generatePython(model, { sourceName: this.store.fileName() }) : null;
                    if (run !== this.generation) return;
                    this.python.set(py);
                    this.error.set(model.states.length > 0 ? null : 'The diagram has no states.');
                } catch (e) {
                    if (run === this.generation) this.error.set((e as Error).message);
                }
            }, 300);
        });
    }

    async downloadPython(): Promise<void> {
        const py = await generatePython(this.store.model(), { sourceName: this.store.fileName() });
        downloadText(`${py.moduleName}.py`, py.code, 'text/x-python');
    }

    async downloadFramework(framework: Framework): Promise<void> {
        const out = await exportToFramework(this.store.model(), framework);
        downloadText(out.fileName, out.code, 'text/plain');
    }

    async downloadTests(): Promise<void> {
        const tests = await generatePythonTests(this.store.model(), { sourceName: this.store.fileName(), counterexamples: this.counterexamples() });
        downloadText(tests.fileName, tests.code, 'text/x-python');
    }

    private counterexamples(): Array<{ property: string; states: string[]; loopStart?: number }> {
        const model = this.store.model();
        const v = this.store.verification();
        const current = v && !v.running && !v.stale ? v : null;
        return (current?.results ?? []).flatMap((r, i) =>
            r?.trace ? [{ property: model.specs[i]?.name ?? model.specs[i]?.expression ?? '', states: r.trace.steps.map(s => s.values['state'] ?? ''), loopStart: r.trace.loopStart }] : []
        );
    }

    async downloadNotebook(): Promise<void> {
        const model = this.store.model();
        const v = this.store.verification();
        const current = v && !v.running && !v.stale ? v : null;
        const counterexamples = this.counterexamples();
        const { notebook, python } = await generateNotebook(model, {
            sourceName: this.store.fileName(),
            verdicts: current?.results.map(r => r?.verdict),
            counterexamples,
            editorUrl: location.origin
        });
        downloadText(`${python.moduleName}.ipynb`, notebook, 'application/x-ipynb+json');
    }
}
