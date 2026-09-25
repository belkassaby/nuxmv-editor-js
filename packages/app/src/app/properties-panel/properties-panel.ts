import { Component, computed, inject } from '@angular/core';
import type { FairnessKind, SpecKind } from '@nuxmv-editor/language';
import { DiagramStore } from '../diagram-store';
import { HelpService } from '../help-dialog/help.service';
import { ProbabilityPanel } from '../probability-panel/probability-panel';
import { ENGINE_LABELS, NuxmvApi, type Engine } from '../nuxmv-api';

/** Temporal properties, fairness constraints, and their verification results. */
@Component({
    selector: 'app-properties-panel',
    imports: [ProbabilityPanel],
    templateUrl: './properties-panel.html'
})
export class PropertiesPanel {
    readonly store = inject(DiagramStore);
    readonly api = inject(NuxmvApi);
    readonly help = inject(HelpService);
    readonly engines = Object.entries(ENGINE_LABELS) as Array<[Engine, string]>;
    readonly kinds: SpecKind[] = ['LTLSPEC', 'CTLSPEC', 'INVARSPEC'];
    readonly fairnessKinds: FairnessKind[] = ['FAIRNESS', 'JUSTICE'];
    readonly placeholders: Record<SpecKind, string> = {
        LTLSPEC: 'e.g. G (request -> F status = ready)',
        CTLSPEC: 'e.g. AG EF state = s0',
        INVARSPEC: 'e.g. !(p1 = c & p2 = c)'
    };

    /** Diagnostics reported by Langium on the text lines holding properties. */
    readonly specProblems = computed(() => {
        const lines = this.store.text().split('\n');
        const problems: string[][] = this.store.model().specs.map(() => []);
        const specLines: number[] = [];
        lines.forEach((l, i) => {
            if (/^\s*(LTLSPEC|CTLSPEC|INVARSPEC)\b/.test(l)) specLines.push(i + 1);
        });
        for (const d of this.store.diagnostics()) {
            const index = specLines.indexOf(d.line);
            if (index >= 0 && index < problems.length && d.severity === 'error') problems[index].push(d.message);
        }
        return problems;
    });

    readonly summary = computed(() => {
        const v = this.store.verification();
        if (!v || v.running) return null;
        const counts = { true: 0, false: 0, unknown: 0, unchecked: 0 };
        v.results.forEach(r => (r ? counts[r.verdict]++ : counts.unchecked++));
        return counts;
    });

    addSpec(kind: SpecKind): void {
        const defaults: Record<SpecKind, string> = { LTLSPEC: 'G TRUE', CTLSPEC: 'AG TRUE', INVARSPEC: 'TRUE' };
        const first = this.store.model().attributes[0];
        const atom = first ? (first.type.kind === 'boolean' ? first.name : `${first.name} = ${first.type.kind === 'enum' ? first.type.values[0] : first.type.low}`) : 'TRUE';
        const expression = kind === 'LTLSPEC' ? `G F ${atom}` : kind === 'CTLSPEC' ? `AG EF ${atom}` : defaults[kind];
        this.store.update(m => m.specs.push({ kind, expression }));
    }

    setSpec(index: number, patch: { kind?: string; name?: string; expression?: string }): void {
        this.store.update(m => {
            const s = m.specs[index];
            if (!s) return;
            if (patch.kind) s.kind = patch.kind as SpecKind;
            if (patch.expression !== undefined && patch.expression.trim()) s.expression = patch.expression.replace(/;+\s*$/, '').trim();
            if (patch.name !== undefined) {
                const name = patch.name.trim();
                if (/^[_a-zA-Z][\w$#]*$/.test(name)) s.name = name;
                else delete s.name;
            }
        });
    }

    removeSpec(index: number): void {
        this.store.update(m => m.specs.splice(index, 1));
    }

    addFairness(): void {
        const first = this.store.model().attributes.find(a => a.type.kind === 'boolean');
        this.store.update(m => m.fairness.push({ kind: 'FAIRNESS', expression: first ? first.name : 'TRUE' }));
    }

    setFairness(index: number, patch: { kind?: string; expression?: string }): void {
        this.store.update(m => {
            const f = m.fairness[index];
            if (!f) return;
            if (patch.kind) f.kind = patch.kind as FairnessKind;
            if (patch.expression !== undefined && patch.expression.trim()) f.expression = patch.expression.replace(/;+\s*$/, '').trim();
        });
    }

    removeFairness(index: number): void {
        this.store.update(m => m.fairness.splice(index, 1));
    }

    setEngine(engine: string): void {
        this.api.engine.set(engine as Engine);
    }

    setBound(value: string): void {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 1) this.api.bound.set(Math.min(1000, Math.floor(n)));
    }
}
