import { Component, computed, inject, signal } from '@angular/core';
import { attributeDomain, type AttributeDef, type AttributeType } from '@nuxmv-editor/language';
import { DiagramStore } from '../diagram-store';
import { pickFile } from '../file-io';
import { HelpService } from '../help-dialog/help.service';

/**
 * Dynamic attribute table: one row per atom, one column per state. This is
 * the interface planned in Figure 4.6 of the dissertation, which replaces the
 * hand-written attributeData.txt file (still importable).
 */
@Component({
    selector: 'app-attribute-table',
    templateUrl: './attribute-table.html'
})
export class AttributeTable {
    readonly store = inject(DiagramStore);
    readonly help = inject(HelpService);
    readonly error = signal<string | null>(null);
    readonly rows = computed(() => this.store.model().attributes.map(a => ({ attribute: a, domain: attributeDomain(a.type) })));

    typeKind(type: AttributeType): string {
        return type.kind;
    }

    domainText(type: AttributeType): string {
        return type.kind === 'enum' ? type.values.join(', ') : type.kind === 'range' ? `${type.low}..${type.high}` : 'TRUE, FALSE';
    }

    addAttribute(): void {
        const used = new Set([...this.store.model().attributes.map(a => a.name), ...this.store.model().states.map(s => s.name)]);
        let i = 0;
        const letters = 'pqrstuvw';
        let name = letters[0];
        while (used.has(name)) name = i < letters.length - 1 ? letters[++i] : `a${i++}`;
        this.store.setAttributes([...this.store.model().attributes, { name, type: { kind: 'boolean' } }]);
    }

    remove(index: number): void {
        this.store.setAttributes(this.store.model().attributes.filter((_, i) => i !== index));
    }

    rename(index: number, input: HTMLInputElement): void {
        const name = input.value.trim();
        const attributes = this.store.model().attributes;
        const error = !/^[_a-zA-Z][\w$#]*$/.test(name)
            ? 'Invalid name.'
            : attributes.some((a, i) => i !== index && a.name === name) || this.store.model().states.some(s => s.name === name)
              ? `'${name}' is already used.`
              : null;
        this.error.set(error);
        if (error) {
            input.value = attributes[index].name;
            return;
        }
        this.replace(index, { ...attributes[index], name });
    }

    setKind(index: number, kind: string): void {
        const attribute = this.store.model().attributes[index];
        const type: AttributeType =
            kind === 'enum' ? { kind: 'enum', values: ['v0', 'v1'] } : kind === 'range' ? { kind: 'range', low: 0, high: 3 } : { kind: 'boolean' };
        this.replace(index, { ...attribute, type }, true);
    }

    setDomain(index: number, input: HTMLInputElement): void {
        const attribute = this.store.model().attributes[index];
        const text = input.value.trim();
        let type: AttributeType | null = null;
        if (attribute.type.kind === 'enum') {
            const values = [...new Set(text.split(/[\s,]+/).filter(Boolean))];
            if (values.length > 0 && values.every(v => /^[_a-zA-Z][\w$#]*$/.test(v) && v !== 'TRUE' && v !== 'FALSE')) type = { kind: 'enum', values };
        } else if (attribute.type.kind === 'range') {
            const m = /^(-?\d+)\s*\.\.\s*(-?\d+)$/.exec(text);
            if (m && Number(m[1]) <= Number(m[2])) type = { kind: 'range', low: Number(m[1]), high: Number(m[2]) };
        }
        if (!type) {
            this.error.set(attribute.type.kind === 'enum' ? 'Enter identifiers separated by commas, e.g. ready, busy.' : 'Enter a range such as 0..5.');
            input.value = this.domainText(attribute.type);
            return;
        }
        this.error.set(null);
        this.replace(index, { ...attribute, type }, true);
    }

    setValue(state: string, attribute: string, value: string): void {
        this.store.update(m => {
            const s = m.states.find(x => x.name === state);
            if (!s) return;
            if (value) s.values[attribute] = value;
            else delete s.values[attribute];
        });
    }

    /** Fills every state with the same value (handy when starting a new attribute). */
    fill(attribute: string, value: string): void {
        this.store.update(m => {
            for (const s of m.states) {
                if (value) s.values[attribute] = value;
                else delete s.values[attribute];
            }
        });
    }

    // ------------------------------------------------------------- variables

    addVariable(): void {
        const m = this.store.model();
        const used = new Set([...m.attributes, ...m.variables, ...m.states].map(x => x.name));
        const candidates = ['retries', 'budget', 'approved', ...Array.from({ length: 50 }, (_, i) => `v${i + 1}`)];
        const name = candidates.find(c => !used.has(c)) ?? `v${Date.now()}`;
        this.store.update(model => model.variables.push({ name, type: { kind: 'range', low: 0, high: 3 }, initial: '0' }));
    }

    removeVariable(index: number): void {
        this.store.update(m => m.variables.splice(index, 1));
    }

    setVariable(index: number, patch: { name?: string; kind?: string; domain?: string; initial?: string }): void {
        this.store.update(m => {
            const v = m.variables[index];
            if (!v) return;
            if (patch.name !== undefined && /^[_a-zA-Z][\w$#]*$/.test(patch.name.trim())) v.name = patch.name.trim();
            if (patch.kind) {
                v.type = patch.kind === 'boolean' ? { kind: 'boolean' } : patch.kind === 'enum' ? { kind: 'enum', values: ['v0', 'v1'] } : { kind: 'range', low: 0, high: 3 };
                v.initial = attributeDomain(v.type)[0];
            }
            if (patch.domain !== undefined) {
                const text = patch.domain.trim();
                const range = /^(-?\d+)\s*\.\.\s*(-?\d+)$/.exec(text);
                if (v.type.kind === 'range' && range && Number(range[1]) <= Number(range[2])) v.type = { kind: 'range', low: Number(range[1]), high: Number(range[2]) };
                if (v.type.kind === 'enum') {
                    const values = [...new Set(text.split(/[\s,]+/).filter(Boolean))];
                    if (values.length > 0) v.type = { kind: 'enum', values };
                }
                if (!attributeDomain(v.type).includes(v.initial)) v.initial = attributeDomain(v.type)[0];
            }
            if (patch.initial !== undefined && attributeDomain(v.type).includes(patch.initial)) v.initial = patch.initial;
        });
    }

    domainOf(type: AttributeType): string[] {
        return attributeDomain(type);
    }

    async importLegacy(): Promise<void> {
        const file = await pickFile('.txt,text/plain');
        if (!file) return;
        try {
            this.store.importLegacy(file.text);
            this.error.set(null);
        } catch (error) {
            this.error.set(`Could not import ${file.name}: ${(error as Error).message}`);
        }
    }

    private replace(index: number, attribute: AttributeDef, dropInvalidValues = false): void {
        const attributes = this.store.model().attributes.map((a, i) => (i === index ? attribute : a));
        this.store.setAttributes(attributes);
        if (dropInvalidValues) {
            const domain = new Set(attributeDomain(attribute.type));
            this.store.update(m => {
                for (const s of m.states) {
                    const v = s.values[attribute.name];
                    if (v !== undefined && !domain.has(v)) delete s.values[attribute.name];
                }
            });
        }
    }
}
