import type { DiagramModel } from './model.js';
import { generatePython } from './python-generator.js';
import { generateSmv } from './smv-generator.js';

export interface NurvPlan {
    /** nuXmv model with a NAME for every LTL property (NuRV monitors properties by name). */
    smv: string;
    /** NuRV command script building and generating one Python monitor per property. */
    script: string;
    /** Observable variables: the control state and the data variables (the attributes follow from the state). */
    observables: string[];
    monitors: Array<{ name: string; expression: string; module: string }>;
}

/**
 * Plans the generation of full-LTL runtime monitors with NuRV (FBK), for the
 * LTL properties the built-in monitors cannot handle (those looking at the
 * future). NuRV monitors "under assumptions": knowing the model, it can give
 * a definite verdict (true or false) as soon as the observed prefix decides
 * the property for every continuation the model allows.
 */
export async function nurvPlan(model: DiagramModel): Promise<NurvPlan> {
    const g = await generatePython(model);
    const named = { ...model, specs: model.specs.map((s, i) => ({ ...s, name: s.name ?? `p${i + 1}` })) };
    const monitors = named.specs
        .map((s, i) => ({ spec: s, info: g.monitors[i] }))
        .filter(({ spec, info }) => spec.kind === 'LTLSPEC' && !info?.monitored)
        .map(({ spec }) => ({ name: spec.name!, expression: spec.expression, module: `nurv_${spec.name!.replace(/\W/g, '_')}` }));
    // Attributes left free in some state are observed too: they do not follow from the state.
    const free = model.attributes.filter(a => model.states.some(s => s.values[a.name] === undefined)).map(a => a.name);
    const observables = ['state', ...model.variables.map(v => v.name), ...free];
    const script = [
        'set input_file "model.smv"',
        'go',
        ...monitors.flatMap(m => [`build_monitor -P "${m.name}" -C observables.list`, `generate_monitor -P "${m.name}" -L "python" -o "${m.module}"`]),
        'quit',
        ''
    ].join('\n');
    return { smv: generateSmv(named).text, script, observables, monitors };
}
