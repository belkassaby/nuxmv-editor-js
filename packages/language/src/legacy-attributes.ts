import type { AttributeType, DiagramModel } from './model.js';

/**
 * Imports the `attributeData.txt` format of the original JungToNusmv tool:
 *
 *     //attribNameList
 *     p q r
 *     //attribValuesList
 *     TRUE FALSE
 *     TRUE FALSE
 *     enum0 enum1
 *     //stateAttribValue
 *     TRUE FALSE FALSE
 *     TRUE TRUE FALSE
 *     enum0 enum0 enum1
 *
 * Row i of `stateAttribValue` gives the value of attribute i in state 0..n.
 * States are matched by position with the states of `model` (in declaration
 * order); missing states are created as `s<i>`.
 */
export function importLegacyAttributes(text: string, model: DiagramModel): DiagramModel {
    const sections: Record<string, string[][]> = {};
    let section: string | undefined;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const header = /^\/\/\s*(attribNameList|attribValuesList|stateAttribValue)\s*$/i.exec(line);
        if (header) {
            section = header[1].toLowerCase();
            sections[section] = [];
            continue;
        }
        if (line.startsWith('//')) continue;
        if (!section) throw new Error(`Unexpected line before any section header: '${line}'`);
        sections[section].push(line.split(/\s+/));
    }

    const names = (sections['attribnamelist'] ?? []).flat();
    const domains = sections['attribvalueslist'] ?? [];
    const perState = sections['stateattribvalue'] ?? [];
    if (names.length === 0) throw new Error('Missing //attribNameList section.');
    if (domains.length !== names.length) {
        throw new Error(`//attribValuesList has ${domains.length} row(s) but ${names.length} attribute(s) are declared.`);
    }
    if (perState.length !== names.length) {
        throw new Error(`//stateAttribValue has ${perState.length} row(s) but ${names.length} attribute(s) are declared.`);
    }

    const result: DiagramModel = JSON.parse(JSON.stringify(model)) as DiagramModel;
    result.attributes = names.map((name, i) => ({ name, type: inferType(domains[i]) }));

    const stateCount = Math.max(...perState.map(r => r.length));
    for (let i = result.states.length; i < stateCount; i++) {
        result.states.push({ name: `s${i}`, initial: i === 0 && result.states.length === 0, values: {} });
    }
    names.forEach((name, attributeIndex) => {
        perState[attributeIndex].forEach((value, stateIndex) => {
            result.states[stateIndex].values[name] = value;
        });
    });
    return result;
}

function inferType(values: string[]): AttributeType {
    const upper = values.map(v => v.toUpperCase());
    if (upper.every(v => v === 'TRUE' || v === 'FALSE' || v === '1' || v === '0')) return { kind: 'boolean' };
    if (values.every(v => /^-?\d+$/.test(v))) {
        const numbers = values.map(Number);
        return { kind: 'range', low: Math.min(...numbers), high: Math.max(...numbers) };
    }
    return { kind: 'enum', values };
}
