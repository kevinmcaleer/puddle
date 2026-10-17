import { flow, src } from '../../tests/helpers/projects';
import { makeGroup } from '../model';
import { autoLayout } from './layout';

const p = flow({
  sources: [src({ id: 'a', format: 'csv' }), src({ id: 'b', format: 'csv' })],
  nodes: [
    { id: 'sa', type: 'source', sourceId: 'a' },
    { id: 'sb', type: 'source', sourceId: 'b' },
    { id: 't', type: 'transform' },
    { id: 'u', type: 'transform' },
    { id: 'out', type: 'output' },
  ],
  wires: [['sa', 't'], ['t', 'out'], ['sb', 'u']],
});

describe('auto layout', () => {
  const laid = autoLayout(p);
  const at = (id: string) => laid.nodes.find((n) => n.id === id)!.position;

  it('flows left to right along every wire', () => {
    for (const e of laid.edges) expect(at(e.to.nodeId).x).toBeGreaterThan(at(e.from.nodeId).x);
  });

  it('never overlaps two nodes', () => {
    const boxes = laid.nodes.map((n) => n.position);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i]!, boxes[j]!];
        expect(Math.abs(a.x - b.x) >= 232 || Math.abs(a.y - b.y) >= 96).toBe(true);
      }
  });

  it('is stable when run twice and leaves an empty project alone', () => {
    expect(autoLayout(laid).nodes.map((n) => n.position)).toEqual(laid.nodes.map((n) => n.position));
    const empty = flow({ nodes: [] });
    expect(autoLayout(empty)).toBe(empty);
  });

  it('changes only positions', () => {
    expect(laid.edges).toEqual(p.edges);
    expect(laid.nodes.map(({ position: _, ...n }) => n)).toEqual(p.nodes.map(({ position: _, ...n }) => n));
  });

  it('lays a collapsed group out as one card, its nodes keeping their places round it', () => {
    const spread = { ...p, nodes: p.nodes.map((n) => (n.id === 't' ? { ...n, position: { x: 0, y: 0 } } : n.id === 'out' ? { ...n, position: { x: 300, y: 50 } } : n)) };
    const grouped = autoLayout(makeGroup(spread, ['t', 'out'], 'g1'));
    const pos = (id: string) => grouped.nodes.find((n) => n.id === id)!.position;
    const card = grouped.groups[0]!.position;
    // The card follows the source that feeds it; inside, the nodes keep their offsets from the card.
    expect(card.x).toBeGreaterThan(pos('sa').x);
    expect(pos('t')).toEqual(card);
    expect(pos('out')).toEqual({ x: card.x + 300, y: card.y + 50 });
  });
});
