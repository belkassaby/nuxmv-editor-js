import cytoscape, { type Core, type LayoutOptions, type Position, type StylesheetJson } from 'cytoscape';
import dagre from 'cytoscape-dagre';

cytoscape.use(dagre);

export type LayoutKind = 'vertical' | 'horizontal' | 'spread' | 'radial' | 'force' | 'circle' | 'grid';

export const LAYOUTS: Array<{ id: LayoutKind; label: string; title: string }> = [
    { id: 'vertical', label: 'Vertical', title: 'Layered, top to bottom from the initial states' },
    { id: 'horizontal', label: 'Horizontal', title: 'Layered, left to right from the initial states' },
    { id: 'spread', label: 'Spread', title: 'Tries many layouts and keeps the one with the fewest overlapping transitions (may be wide)' },
    { id: 'radial', label: 'Radial (hub)', title: 'Most connected state in the centre, the flow around it: compact, fits the screen' },
    { id: 'force', label: 'Force', title: 'Physical simulation: connected states attract, all states repel' },
    { id: 'circle', label: 'Circle', title: 'States on a circle' },
    { id: 'grid', label: 'Grid', title: 'States on a grid' }
];

type Positions = Record<string, Position>;

/**
 * Computes node positions for a layout without touching the visible graph:
 * the layout runs on a headless copy that has the same elements and style
 * (so node sizes match), and the caller animates to the result.
 */
export async function computeLayout(cy: Core, kind: LayoutKind, style: StylesheetJson, aspect = 1.6): Promise<Positions> {
    const copy = cytoscape({ headless: true, styleEnabled: true, style, layout: { name: 'preset' }, elements: cy.elements().jsons() as never });
    try {
        if (kind === 'spread') return await bestOf(copy, spreadCandidates(), aspect);
        if (kind === 'radial') return await radial(copy, aspect);
        await run(copy, optionsFor(kind));
        return positionsOf(copy);
    } finally {
        copy.destroy();
    }
}

/** Hub in the centre, the other states on a ring in dagre's pipeline order, then refined. */
async function radial(cy: Core, aspect: number): Promise<Positions> {
    await run(cy, { name: 'dagre', rankDir: 'LR', ranker: 'network-simplex', fit: false, animate: false } as LayoutOptions);
    const order = cy
        .nodes()
        .sort((a, b) => a.position().x - b.position().x || a.position().y - b.position().y)
        .map(n => n.id());
    hubRing(cy, order, aspect);
    return refineBySwaps(cy, positionsOf(cy), score(cy, aspect), aspect);
}

function optionsFor(kind: Exclude<LayoutKind, 'spread' | 'radial'>): LayoutOptions {
    const common = { fit: false, animate: false, padding: 40 };
    switch (kind) {
        case 'vertical':
        case 'horizontal':
            return {
                ...common,
                name: 'dagre',
                rankDir: kind === 'vertical' ? 'TB' : 'LR',
                nodeSep: 50,
                rankSep: 80,
                edgeSep: 20,
                ranker: 'network-simplex',
                nodeDimensionsIncludeLabels: false
            } as LayoutOptions;
        case 'force':
            return { ...common, name: 'cose', idealEdgeLength: () => 120, nodeRepulsion: () => 80000, nodeOverlap: 40, gravity: 0.3, numIter: 2000, randomize: true } as LayoutOptions;
        case 'circle':
            return { ...common, name: 'circle', avoidOverlap: true, spacingFactor: 1.3, startAngle: -Math.PI / 2 } as LayoutOptions;
        case 'grid':
            return { ...common, name: 'grid', avoidOverlap: true, avoidOverlapPadding: 30, condense: false, spacingFactor: 1.2 } as LayoutOptions;
    }
}

function spreadCandidates(): LayoutOptions[] {
    const candidates: LayoutOptions[] = [];
    // Layered layouts are fast, so try every direction, ranker, alignment and cycle breaker.
    for (const rankDir of ['TB', 'LR']) {
        for (const ranker of ['network-simplex', 'tight-tree', 'longest-path']) {
            for (const align of [undefined, 'UL', 'UR', 'DL', 'DR']) {
                for (const acyclicer of [undefined, 'greedy']) {
                    candidates.push({
                        name: 'dagre',
                        rankDir,
                        ranker,
                        align,
                        acyclicer,
                        nodeSep: 90,
                        rankSep: 130,
                        edgeSep: 40,
                        nodeDimensionsIncludeLabels: false,
                        fit: false,
                        animate: false
                    } as LayoutOptions);
                }
            }
        }
    }
    for (let i = 0; i < 6; i++) {
        candidates.push({
            name: 'cose',
            randomize: true,
            idealEdgeLength: () => 170,
            nodeRepulsion: () => 400000,
            nodeOverlap: 80,
            gravity: 0.15,
            numIter: 2500,
            fit: false,
            animate: false
        } as LayoutOptions);
    }
    candidates.push({ name: 'circle', avoidOverlap: true, spacingFactor: 1.8, fit: false, animate: false } as LayoutOptions);
    return candidates;
}

async function bestOf(cy: Core, candidates: LayoutOptions[], aspect: number): Promise<Positions> {
    let best: Positions = positionsOf(cy);
    let bestScore = Number.POSITIVE_INFINITY;
    const consider = () => {
        const s = score(cy, aspect);
        if (s < bestScore) {
            bestScore = s;
            best = positionsOf(cy);
        }
    };
    for (const options of candidates) {
        await run(cy, options);
        consider();
        // Also try the pipeline order found by dagre around a central hub.
        if (options.name === 'dagre') {
            const order = cy.nodes().sort((a, b) =>
                (options as { rankDir?: string }).rankDir === 'LR' ? a.position().x - b.position().x || a.position().y - b.position().y : a.position().y - b.position().y || a.position().x - b.position().x
            );
            const ids = order.map(n => n.id());
            for (const stretch of [0.7, 1, 1.4]) {
                hubRing(cy, ids, aspect * stretch);
                consider();
            }
        }
    }
    return refineBySwaps(cy, best, bestScore, aspect);
}

/**
 * Hub layout: the most connected state in the centre, the others on a ring
 * in pipeline order, so edges back to the hub are non-crossing spokes and
 * consecutive steps are neighbours on the ring.
 */
function hubRing(cy: Core, order: string[], aspect: number): void {
    const hub = cy.nodes().max(n => n.degree(false)).ele;
    const ring = order.filter(id => id !== hub.id());
    let maxW = 0;
    cy.nodes().forEach(n => {
        maxW = Math.max(maxW, n.width());
    });
    // Circumference large enough for the widest states side by side.
    const radius = Math.max(220, (ring.length * (maxW * 0.75 + 40)) / (2 * Math.PI));
    const rx = radius * Math.sqrt(aspect);
    const ry = radius / Math.sqrt(aspect);
    cy.batch(() => {
        hub.position({ x: 0, y: 0 });
        ring.forEach((id, i) => {
            const a = -Math.PI / 2 + (2 * Math.PI * i) / ring.length;
            cy.getElementById(id).position({ x: rx * Math.cos(a), y: ry * Math.sin(a) });
        });
    });
}

/**
 * Hill climbing on the best candidate: swap the positions of two states
 * whenever that lowers the score, until no swap helps (or a few passes).
 */
function refineBySwaps(cy: Core, start: Positions, startScore: number, aspect: number): Positions {
    const nodes = cy.nodes();
    const ids = nodes.map(n => n.id());
    cy.batch(() => nodes.forEach(n => void n.position({ ...start[n.id()] })));
    let current = startScore;
    for (let pass = 0; pass < 4; pass++) {
        let improved = false;
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const a = cy.getElementById(ids[i]);
                const b = cy.getElementById(ids[j]);
                const pa = { ...a.position() };
                const pb = { ...b.position() };
                a.position(pb);
                b.position(pa);
                const s = score(cy, aspect);
                if (s < current - 1e-9) {
                    current = s;
                    improved = true;
                } else {
                    a.position(pa);
                    b.position(pb);
                }
            }
        }
        if (!improved) break;
    }
    return positionsOf(cy);
}

function run(cy: Core, options: LayoutOptions): Promise<void> {
    const layout = cy.layout(options);
    const done = layout.promiseOn('layoutstop').then(() => undefined);
    layout.run();
    return done;
}

function positionsOf(cy: Core): Positions {
    const positions: Positions = {};
    cy.nodes().forEach(n => {
        positions[n.id()] = { ...n.position() };
    });
    return positions;
}

/**
 * Lower is better. Counts pairs of transitions that cross (drawn as straight
 * segments between state centres), transitions running through a state they
 * do not connect, and overlapping states. A layout whose shape is far from the
 * viewport's (a long thin strip that would have to be shown at a tiny zoom)
 * is penalised, and ties go to the more compact layout.
 */
export function score(cy: Core, aspect = 1.6): number {
    return scoreParts(cy, aspect).total;
}

export function scoreParts(cy: Core, aspect = 1.6) {
    const nodes = cy.nodes().map(n => ({ id: n.id(), p: n.position(), rx: n.width() / 2 + 6, ry: n.height() / 2 + 6 }));
    const byId = new Map(nodes.map(n => [n.id, n]));
    const segments = cy
        .edges()
        .map(e => ({ s: e.source().id(), t: e.target().id() }))
        .filter(seg => seg.s !== seg.t);
    // Two opposite transitions between the same states are drawn as separate curves.
    const unique = segments.filter((seg, i) => segments.findIndex(o => (o.s === seg.s && o.t === seg.t) || (o.s === seg.t && o.t === seg.s)) === i);

    let crossings = 0;
    for (let i = 0; i < unique.length; i++) {
        for (let j = i + 1; j < unique.length; j++) {
            const a = unique[i];
            const b = unique[j];
            if (a.s === b.s || a.s === b.t || a.t === b.s || a.t === b.t) continue;
            if (intersects(byId.get(a.s)!.p, byId.get(a.t)!.p, byId.get(b.s)!.p, byId.get(b.t)!.p)) crossings++;
        }
    }

    let throughNodes = 0;
    for (const seg of unique) {
        const p = byId.get(seg.s)!.p;
        const q = byId.get(seg.t)!.p;
        for (const n of nodes) {
            if (n.id === seg.s || n.id === seg.t) continue;
            if (segmentHitsEllipse(p, q, n.p, n.rx, n.ry)) throughNodes++;
        }
    }

    let overlaps = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        minX = Math.min(minX, a.p.x);
        minY = Math.min(minY, a.p.y);
        maxX = Math.max(maxX, a.p.x);
        maxY = Math.max(maxY, a.p.y);
        for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            if (Math.abs(a.p.x - b.p.x) < a.rx + b.rx && Math.abs(a.p.y - b.p.y) < a.ry + b.ry) overlaps++;
        }
    }
    const w = maxX - minX + 200;
    const h = maxY - minY + 120;
    const shape = nodes.length > 2 ? Math.abs(Math.log(w / h / aspect)) : 0;
    const total = crossings * 10 + throughNodes * 15 + overlaps * 50 + shape * 6 + Math.log10(w * h) * 0.1;
    return { total, crossings, throughNodes, overlaps, shape };
}

function orientation(a: Position, b: Position, c: Position): number {
    const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
    return Math.abs(v) < 1e-9 ? 0 : v > 0 ? 1 : 2;
}

function intersects(p1: Position, q1: Position, p2: Position, q2: Position): boolean {
    return orientation(p1, q1, p2) !== orientation(p1, q1, q2) && orientation(p2, q2, p1) !== orientation(p2, q2, q1);
}

function segmentHitsEllipse(p: Position, q: Position, c: Position, rx: number, ry: number): boolean {
    // Scale so the ellipse becomes the unit circle, then test segment-circle distance.
    const ax = (p.x - c.x) / rx;
    const ay = (p.y - c.y) / ry;
    const bx = (q.x - c.x) / rx;
    const by = (q.y - c.y) / ry;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const x = ax + t * dx;
    const y = ay + t * dy;
    return x * x + y * y < 1;
}
