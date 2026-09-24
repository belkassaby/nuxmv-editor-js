import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { DiagramStore } from '../diagram-store';

/**
 * Step-by-step view of a counterexample returned by nuXmv, shown on the
 * diagram, and an interactive simulator of the drawn model.
 */
@Component({
    selector: 'app-trace-panel',
    templateUrl: './trace-panel.html'
})
export class TracePanel implements OnDestroy {
    readonly store = inject(DiagramStore);
    readonly playing = signal(false);
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
        return path.map(name => ({ name, state: model.states.find(s => s.name === name) }));
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

    close(): void {
        this.stop();
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
