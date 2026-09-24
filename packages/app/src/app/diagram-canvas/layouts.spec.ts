import cytoscape, { type StylesheetJson } from 'cytoscape';
import { computeLayout, LAYOUTS, score, scoreParts } from './layouts';
import { cytoscapeToSvg } from './svg-export';

const style: StylesheetJson = [{ selector: 'node', style: { width: 60, height: 40, label: 'data(id)' } }];

function graph(nodes: Record<string, [number, number]>, edges: Array<[string, string]>) {
    return cytoscape({
        headless: true,
        styleEnabled: true,
        style,
        layout: { name: 'preset' },
        elements: [
            ...Object.entries(nodes).map(([id, [x, y]]) => ({ data: { id }, position: { x, y } })),
            ...edges.map(([source, target], i) => ({ data: { id: `e${i}`, source, target } }))
        ]
    });
}

describe('layout scoring', () => {
    it('counts crossing transitions', () => {
        const crossing = graph({ a: [0, 0], b: [200, 200], c: [200, 0], d: [0, 200] }, [['a', 'b'], ['c', 'd']]);
        const apart = graph({ a: [0, 0], b: [200, 0], c: [0, 200], d: [200, 200] }, [['a', 'b'], ['c', 'd']]);
        expect(scoreParts(crossing).crossings).toBe(1);
        expect(scoreParts(apart).crossings).toBe(0);
        expect(score(apart)).toBeLessThan(score(crossing));
    });

    it('counts transitions running through a state and overlapping states', () => {
        const through = graph({ a: [0, 0], m: [150, 0], b: [300, 0] }, [['a', 'b']]);
        expect(scoreParts(through).throughNodes).toBe(1);
        const overlap = graph({ a: [0, 0], b: [10, 10] }, []);
        expect(scoreParts(overlap).overlaps).toBe(1);
    });

    it('ignores self-loops and opposite pairs drawn as separate curves', () => {
        const g = graph({ a: [0, 0], b: [200, 0] }, [['a', 'b'], ['b', 'a'], ['a', 'a']]);
        expect(scoreParts(g).crossings).toBe(0);
    });
});

describe('layouts', () => {
    // A small pipeline with a hub, like the agentic examples.
    const nodes: Record<string, [number, number]> = { hub: [0, 0], s1: [0, 0], s2: [0, 0], s3: [0, 0], s4: [0, 0], s5: [0, 0] };
    const edges: Array<[string, string]> = [['hub', 's1'], ['s1', 's2'], ['s2', 's3'], ['s3', 's4'], ['s4', 's5'], ['s2', 'hub'], ['s3', 'hub'], ['s4', 'hub'], ['s5', 'hub']];

    it.each(LAYOUTS.map(l => l.id))('%s places every state without overlaps', async kind => {
        const cy = graph(nodes, edges);
        const positions = await computeLayout(cy, kind, style);
        expect(Object.keys(positions).sort()).toEqual(Object.keys(nodes).sort());
        cy.nodes().forEach(n => void n.position(positions[n.id()]));
        expect(scoreParts(cy).overlaps).toBe(0);
    });

    it('spread finds a layout without crossings for a planar pipeline', async () => {
        const cy = graph(nodes, edges);
        const positions = await computeLayout(cy, 'spread', style);
        cy.nodes().forEach(n => void n.position(positions[n.id()]));
        expect(scoreParts(cy).crossings).toBe(0);
    });

    it('radial puts the most connected state in the centre', async () => {
        const cy = graph(nodes, edges);
        const p = await computeLayout(cy, 'radial', style);
        const others = Object.entries(p).filter(([id]) => id !== 'hub');
        const cx = others.reduce((s, [, q]) => s + q.x, 0) / others.length;
        const cyy = others.reduce((s, [, q]) => s + q.y, 0) / others.length;
        const radius = Math.min(...others.map(([, q]) => Math.hypot(q.x - p['hub'].x, q.y - p['hub'].y)));
        expect(Math.hypot(cx - p['hub'].x, cyy - p['hub'].y)).toBeLessThan(radius);
    });

    it('does not move the visible graph', async () => {
        const cy = graph(nodes, edges);
        const before = cy.nodes().map(n => ({ ...n.position() }));
        await computeLayout(cy, 'spread', style);
        expect(cy.nodes().map(n => ({ ...n.position() }))).toEqual(before);
    });
});

describe('SVG export', () => {
    it('writes a well-formed document with one ellipse per state and escaped labels', () => {
        const cy = cytoscape({
            headless: true,
            styleEnabled: true,
            style: [{ selector: 'node', style: { width: 60, height: 40, label: 'data(label)' } }],
            layout: { name: 'preset' },
            elements: [
                { data: { id: 'a', label: 'a & <b>' }, position: { x: 0, y: 0 } },
                { data: { id: 'b', label: 'b' }, position: { x: 200, y: 0 } }
            ]
        });
        const svg = cytoscapeToSvg(cy, '#ffffff');
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        expect(doc.querySelector('parsererror')).toBeNull();
        expect(doc.querySelectorAll('ellipse')).toHaveLength(2);
        expect(svg).toContain('a &amp; &lt;b&gt;');
    });
});
