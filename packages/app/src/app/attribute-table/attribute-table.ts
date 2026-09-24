import { Component, computed, inject, signal } from '@angular/core';
import { attributeDomain, type AttributeDef, type AttributeType } from '@nuxmv-editor/language';
import { DiagramStore } from '../diagram-store';
import { pickFile } from '../file-io';

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
