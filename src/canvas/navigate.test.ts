import { describe, expect, it } from 'vitest';
import { flow, src } from '../../tests/helpers/projects';
import type { Project } from '../model';
import { firstNode, neighbour } from './navigate';

/** Two sources joined, then split into two outputs:  a ─┐        ┌─ out1
 *                                                       ├─ j ─ t ─┤
 *                                                    b ─┘        └─ out2   (plus a lone source c below b) */
function shop(): Project {
  const p = flow({
    sources: [src({ id: 'sa', format: 'csv' }), src({ id: 'sb', format: 'csv' }), src({ id: 'sc', format: 'csv' })],
    nodes: [
      { id: 'a', type: 'source', sourceId: 'sa' },
      { id: 'b', type: 'source', sourceId: 'sb' },
      { id: 'c', type: 'source', sourceId: 'sc' },
      { id: 'j', type: 'join' },
      { id: 't', type: 'transform' },
      { id: 'out1', type: 'output' },
      { id: 'out2', type: 'output' },
    ],
    wires: [['a', 'j', 'left'], ['b', 'j', 'right'], ['j', 't'], ['t', 'out1'], ['t', 'out2']],
  });
  const at: Record<string, [number, number]> = { a: [0, 0], b: [0, 200], c: [0, 400], j: [300, 100], t: [600, 100], out1: [900, 0], out2: [900, 200] };
  return { ...p, nodes: p.nodes.map((n) => ({ ...n, position: { x: at[n.id]![0], y: at[n.id]![1] } })) };
}

const go = (p: Project, from: string | null, dir: Parameters<typeof neighbour>[2]) => neighbour(p, from, dir)?.id;

describe('arrow-key navigation', () => {
  it('follows wires left and right, nearest in height first', () => {
    const p = shop();
    expect(go(p, 'a', 'downstream')).toBe('j');
    expect(go(p, 'j', 'upstream')).toBe('a');
    expect(go(p, 't', 'downstream')).toBe('out1');
    expect(go(p, 'j', 'downstream')).toBe('t');
    expect(go(p, 'out2', 'upstream')).toBe('t');
  });

  it('moves up and down between nodes wired alongside', () => {
    const p = shop();
    expect(go(p, 'a', 'below')).toBe('b');
    expect(go(p, 'b', 'above')).toBe('a');
    expect(go(p, 'out1', 'below')).toBe('out2');
    expect(go(p, 'out2', 'above')).toBe('out1');
  });

  it('moves between unwired sources too, at the start of the flow', () => {
    const p = shop();
    expect(go(p, 'c', 'above')).toBe('b');
  });

  it('stays put where there is nowhere to go', () => {
    const p = shop();
    expect(go(p, 'a', 'upstream')).toBeUndefined();
    expect(go(p, 'a', 'above')).toBeUndefined();
    expect(go(p, 'out1', 'downstream')).toBeUndefined();
    expect(go(p, 't', 'above')).toBeUndefined();
  });

  it('starts from the top-left node when nothing is selected', () => {
    const p = shop();
    expect(go(p, null, 'downstream')).toBe('a');
    expect(go(p, 'gone', 'below')).toBe('a');
    expect(firstNode(flow({ nodes: [] }))).toBeUndefined();
  });
});
