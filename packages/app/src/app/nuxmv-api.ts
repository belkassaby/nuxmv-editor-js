import { Injectable, inject, signal } from '@angular/core';
import { matchResults, type NuxmvOutput } from '@nuxmv-editor/language';
import { DiagramStore } from './diagram-store';

export type Engine = 'bdd' | 'bmc' | 'ic3';

export const ENGINE_LABELS: Record<Engine, string> = {
    bdd: 'BDD (exact, CTL + LTL + invariants)',
    bmc: 'Bounded model checking (LTL)',
    ic3: 'IC3 (invariants + LTL, CTL via BDD)'
};

interface VerifyResponse extends NuxmvOutput {
    model: string;
    engine: Engine;
    command: string;
    exitCode: number | null;
    timedOut: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
}

export interface NuxmvStatus {
    checked: boolean;
    available: boolean;
    version?: string;
    error?: string;
}

/** Talks to the Node backend, which runs nuXmv on the generated model. */
@Injectable({ providedIn: 'root' })
export class NuxmvApi {
    private readonly store = inject(DiagramStore);
    readonly status = signal<NuxmvStatus>({ checked: false, available: false });
    readonly engine = signal<Engine>('bdd');
    readonly bound = signal(10);

    async refreshStatus(): Promise<void> {
        try {
            const res = await fetch('api/health');
            if (!res.ok) throw new Error(`Backend answered ${res.status}`);
            const body = (await res.json()) as { nuxmv: { available: boolean; version?: string; error?: string } };
            this.status.set({ checked: true, ...body.nuxmv });
        } catch (error) {
            this.status.set({ checked: true, available: false, error: `Backend not reachable (${(error as Error).message}). Start it with "npm start".` });
        }
    }

    async verify(): Promise<void> {
        const generated = this.store.generated();
        const specs = this.store.model().specs;
        if (generated.error) {
            this.store.setVerification({ running: false, errors: [generated.error], warnings: [], results: specs.map(() => undefined) });
            return;
        }
        const engine = this.engine();
        this.store.setVerification({ running: true, engine, errors: [], warnings: [], results: specs.map(() => undefined), model: generated.text });
        try {
            const res = await fetch('api/verify', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ model: generated.text, engine, bound: this.bound() })
            });
            const body = (await res.json()) as VerifyResponse & { error?: string };
            if (!res.ok) throw new Error(body.error ?? `Backend answered ${res.status}`);
            this.store.setVerification({
                running: false,
                engine: body.engine,
                command: body.command,
                stdout: body.stdout,
                stderr: body.stderr,
                model: generated.text,
                errors: body.errors,
                warnings: body.warnings,
                results: matchResults(specs, body.results),
                durationMs: body.durationMs,
                exitCode: body.exitCode,
                timedOut: body.timedOut,
                stale: generated.text !== this.store.generated().text
            });
        } catch (error) {
            this.store.setVerification({
                running: false,
                engine,
                errors: [],
                warnings: [],
                results: specs.map(() => undefined),
                requestError: (error as Error).message
            });
        }
    }
}
