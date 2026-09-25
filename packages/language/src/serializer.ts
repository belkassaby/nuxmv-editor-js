import { attributeTypeToString, type DiagramModel, type StateDef } from './model.js';

/**
 * Writes a {@link DiagramModel} back to `.nxd` text. Used whenever the diagram
 * is edited graphically so that the text editor always mirrors the drawing.
 */
export function serializeDiagram(model: DiagramModel): string {
    const out: string[] = [];
    out.push(`diagram ${model.name && model.name.length > 0 ? model.name : 'main'}`);

    if (model.attributes.length > 0) {
        out.push('', 'attributes {');
        const width = Math.max(...model.attributes.map(a => a.name.length));
        for (const attribute of model.attributes) {
            out.push(`  ${attribute.name.padEnd(width)} : ${attributeTypeToString(attribute.type)};`);
        }
        out.push('}');
    }

    if (model.variables.length > 0) {
        out.push('', 'variables {');
        const width = Math.max(...model.variables.map(v => v.name.length));
        for (const v of model.variables) out.push(`  ${v.name.padEnd(width)} : ${attributeTypeToString(v.type)} := ${v.initial};`);
        out.push('}');
    }

    if (model.states.length > 0) {
        out.push('');
        for (const state of model.states) out.push(serializeState(state, model));
    }

    if (model.transitions.length > 0) {
        out.push('');
        for (const t of model.transitions) {
            let line = `${t.source} -> ${t.target}${t.label ? ` : ${quote(t.label)}` : ''}`;
            if (t.guard) line += ` when ${t.guard}`;
            if (t.updates && t.updates.length > 0) line += ` do ${t.updates.map(u => `${u.variable} := ${u.expression}`).join(', ')}`;
            if (t.probability !== undefined) line += ` prob ${t.probability}`;
            out.push(line + ';');
        }
    }

    if (model.fairness.length > 0) {
        out.push('');
        for (const f of model.fairness) out.push(`${f.kind} ${f.expression};`);
    }

    if (model.specs.length > 0) {
        out.push('');
        for (const s of model.specs) out.push(`${s.kind}${s.name ? ` NAME ${s.name} :=` : ''} ${s.expression};`);
    }

    return out.join('\n') + '\n';
}

function serializeState(state: StateDef, model: DiagramModel): string {
    let line = `${state.initial ? 'initial ' : ''}state ${state.name}`;
    if (state.label) line += ` ${quote(state.label)}`;
    // Keep the declaration order of the attributes, then any unknown leftovers.
    const names = [
        ...model.attributes.map(a => a.name).filter(n => n in state.values),
        ...Object.keys(state.values).filter(n => !model.attributes.some(a => a.name === n))
    ];
    const assignments = names.filter(n => state.values[n] !== '').map(n => `${n} = ${state.values[n]}`);
    if (assignments.length > 0) line += ` { ${assignments.join(', ')} }`;
    if (state.position) line += ` at (${Math.round(state.position.x)}, ${Math.round(state.position.y)})`;
    return line;
}

function quote(text: string): string {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
