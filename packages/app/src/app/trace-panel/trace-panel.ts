import { KeyValuePipe } from '@angular/common';
import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { checkConformance, parseTrace } from '@provenflow/language';
import { DiagramStore } from '../diagram-store';
import { pickFile } from '../file-io';
import { HelpService } from '../help-dialog/help.service';
import { LiveLink } from '../live-link';
import { CodeExport } from '../code-export';

/**
 * Step-by-step view of a counterexample returned by nuXmv, shown on the
 * diagram, and an interactive simulator of the drawn model.
 */
@Component({
    selector: 'app-trace-panel',
    imports: [KeyValuePipe],
    templateUrl: './trace-panel.html'
})
export class TracePanel implements OnDestroy {
    readonly store = inject(DiagramStore);
    readonly live = inject(LiveLink);
    readonly code = inject(CodeExport);
    readonly help = inject(HelpService);
    readonly playing = signal(false);
    readonly origin = location.origin;
    readonly liveRows = computed(() => [...this.live.updates()].reverse().slice(0, 50));
    private timer: ReturnType<typeof setInterval> | undefined;

    readonly spec = computed(() => {
        const t = this.store.trace();
        return t ? this.store.model().specs[t.specIndex] : undefined;
    });

    readonly variables = computed(() => {
        const t = this.store.trace();
        if (!t) return [];
        const names: string[] = [];
        for (const step of t.trace.steps) for (const k of Object.keys(step.values)) if (!names.includes(k)) names.push(k);
        // `state` first, then the attributes in declaration order.
        const order = ['state', ...this.store.model().attributes.map(a => a.name)];
        return names.sort((a, b) => rank(order, a) - rank(order, b));
    });

    readonly simulationRows = computed(() => {
        const path = this.store.simulation() ?? [];
        const model = this.store.model();
        return path.map(c => ({ name: c.state, state: model.states.find(s => s.name === c.state), variables: c.variables }));
    });

    toggle(): void {
        if (this.playing()) return this.stop();
        const t = this.store.trace();
        if (!t) return;
        if (this.store.traceStep() >= t.trace.steps.length - 1) this.store.traceStep.set(0);
        this.playing.set(true);
        this.timer = setInterval(() => {
            const trace = this.store.trace();
            if (!trace || this.store.traceStep() >= trace.trace.steps.length - 1) return this.stop();
            this.store.stepTrace(1);
        }, 900);
    }

    stop(): void {
        clearInterval(this.timer);
        this.playing.set(false);
    }

    readonly importError = signal<string | null>(null);

    /** Trace conformance: check a recorded run (JSONL or OpenTelemetry JSON) against the model. */
    async importRun(): Promise<void> {
        const file = await pickFile('.jsonl,.json,.ndjson,application/json');
        if (!file) return;
        try {
            const records = parseTrace(file.text);
            if (records.length === 0) throw new Error('the file contains no steps');
            const report = await checkConformance(this.store.model(), records);
            this.importError.set(null);
            this.store.showRecorded(report, file.name);
        } catch (error) {
            this.importError.set(`Could not check ${file.name}: ${(error as Error).message}`);
        }
    }

    issuesAt(step: number): string[] {
        return (this.store.trace()?.issues ?? []).filter(i => i.step === step).map(i => i.message);
    }

    fmt(value: unknown): string {
        return value === true ? 'TRUE' : value === false ? 'FALSE' : value === undefined ? '?' : String(value);
    }

    close(): void {
        this.stop();
        this.live.disconnect();
        this.store.stopHighlight();
    }

    ngOnDestroy(): void {
        this.stop();
    }
}

function rank(order: string[], name: string): number {
    const i = order.indexOf(name);
    return i < 0 ? order.length : i;
}
