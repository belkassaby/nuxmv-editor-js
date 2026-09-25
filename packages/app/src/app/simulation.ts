import { successors, type Configuration, type DiagramModel, type Semantics } from '@provenflow/language';

/**
 * Simulation of the drawn model, as plain functions of the model: the store
 * keeps the path, these compute where it can go (same semantics as the
 * generated nuXmv model: guards, updates, and stutter when nothing is enabled).
 */

export function initialStates(model: DiagramModel): string[] {
    const initial = model.states.filter(s => s.initial).map(s => s.name);
    return initial.length > 0 ? initial : model.states.slice(0, 1).map(s => s.name);
}

export function initialConfigurations(model: DiagramModel, semantics: Semantics | null): Configuration[] {
    return semantics ? semantics.initialConfigurations() : initialStates(model).map(state => ({ state, variables: {} }));
}

/** States the simulation can move to next. */
export function candidates(model: DiagramModel, semantics: Semantics | null, path: Configuration[]): string[] {
    const last = path[path.length - 1];
    if (!last) return initialStates(model);
    return semantics ? [...new Set(semantics.successors(last).map(s => s.config.state))] : successors(model, last.state);
}

/** The path extended with a step to `state`, or unchanged when `state` is not reachable in one step. */
export function stepTo(model: DiagramModel, semantics: Semantics | null, path: Configuration[], state: string): Configuration[] {
    const last = path[path.length - 1];
    if (!last) {
        const start = initialConfigurations(model, semantics).find(c => c.state === state);
        return start ? [start] : path;
    }
    const step = semantics
        ? semantics.successors(last).find(s => s.config.state === state)?.config
        : successors(model, last.state).includes(state)
          ? { state, variables: { ...last.variables } }
          : undefined;
    return step ? [...path, step] : path;
}
