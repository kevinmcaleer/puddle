import { describe, expect, it } from 'vitest';
import { flow, src, step } from '../../tests/helpers/projects';
import { removeNodes } from './edits';
import { canMakeGroup, groupOf, groupPorts, makeGroup, moveGroup, renameGroup, setGroupCollapsed, ungroup } from './groups';
import { parseProject } from './project';
import type { Project } from './schema';
import { groupNodes } from './steps';

// in → a → b → out, with a second source side wired into b.
const base = (): Project => {
  const p = flow({
    sources: [src({ id: 'cust', format: 'csv' }), src({ id: 'codes', format: 'csv' })],
    nodes: [
      { id: 'in', type: 'source', sourceId: 'cust' },
      { id: 'side', type: 'source', sourceId: 'codes' },
      { id: 'a', type: 'transform', steps: [step('s1', 'trimWhitespace', { columns: ['name'] })] },
      { id: 'b', type: 'join' },
      { id: 'out', type: 'output' },
    ],
    wires: [['in', 'a'], ['a', 'b', 'left'], ['side', 'b', 'right'], ['b', 'out']],
  });
  const at: Record<string, { x: number; y: number }> = { in: { x: 0, y: 0 }, side: { x: 0, y: 200 }, a: { x: 300, y: 0 }, b: { x: 600, y: 100 }, out: { x: 900, y: 100 } };
  return { ...p, nodes: p.nodes.map((n) => ({ ...n, position: at[n.id]! })) };
};

describe('node groups', () => {
  it('gathers two or more nodes into a collapsed group whose card sits at their top left', () => {
    const p = makeGroup(base(), ['a', 'b'], 'g1');
    expect(p.groups).toEqual([{ id: 'g1', name: 'Group 1', nodeIds: ['a', 'b'], collapsed: true, position: { x: 300, y: 0 } }]);
    expect(groupOf(p, 'b')?.id).toBe('g1');
    // The graph that runs is untouched.
    expect(p.nodes).toEqual(base().nodes);
    expect(p.edges).toEqual(base().edges);
    expect(makeGroup(p, ['in', 'side'], 'g2').groups.map((g) => g.name)).toEqual(['Group 1', 'Group 2']);
  });

  it('refuses one node, or a node already in a group', () => {
    expect(canMakeGroup(base(), ['a'])).toEqual({ ok: false, reason: 'Select two or more nodes to group them.' });
    const p = makeGroup(base(), ['a', 'b'], 'g1');
    expect(canMakeGroup(p, ['b', 'out'])).toEqual({ ok: false, reason: 'b is in a group already. Ungroup it first.' });
    expect(makeGroup(p, ['b', 'out'])).toBe(p);
  });

  it('shows the wires coming in and the results going out', () => {
    const p = makeGroup(base(), ['a', 'b'], 'g1');
    expect(groupPorts(p, p.groups[0]!)).toEqual({
      inputs: [
        { edgeId: 'e0', fromNodeId: 'in', toNodeId: 'a' },
        { edgeId: 'e2', fromNodeId: 'side', toNodeId: 'b' },
      ],
      outputs: [{ nodeId: 'b' }],
    });
    // A node wired to nothing yet is an output too; an Output node gives nothing out.
    const ends = makeGroup(base(), ['b', 'out'], 'g2');
    expect(groupPorts(ends, ends.groups[0]!).outputs).toEqual([]);
    const loose = makeGroup({ ...base(), edges: base().edges.filter((e) => e.id !== 'e1') }, ['a', 'side'], 'g3');
    expect(groupPorts(loose, loose.groups[0]!).outputs).toEqual([{ nodeId: 'a' }, { nodeId: 'side' }]);
  });

  it('opens, closes, renames and ungroups', () => {
    let p = makeGroup(base(), ['a', 'b'], 'g1');
    p = setGroupCollapsed(p, 'g1', false);
    expect(p.groups[0]!.collapsed).toBe(false);
    p = renameGroup(p, 'g1', '  Clean up  ');
    expect(p.groups[0]!.name).toBe('Clean up');
    expect(renameGroup(p, 'g1', ' ')).toBe(p);
    expect(ungroup(p, 'g1').groups).toEqual([]);
  });

  it('moving a collapsed card moves its nodes with it', () => {
    const p = moveGroup(makeGroup(base(), ['a', 'b'], 'g1'), 'g1', { x: 350, y: 40 });
    expect(p.groups[0]!.position).toEqual({ x: 350, y: 40 });
    expect(p.nodes.filter((n) => ['a', 'b'].includes(n.id)).map((n) => n.position)).toEqual([
      { x: 350, y: 40 },
      { x: 650, y: 140 },
    ]);
    expect(p.nodes.find((n) => n.id === 'out')!.position).toEqual({ x: 900, y: 100 });
  });

  it('a deleted or merged node leaves its group, and an empty group goes', () => {
    const p = makeGroup(base(), ['a', 'b'], 'g1');
    expect(removeNodes(p, ['b']).groups[0]!.nodeIds).toEqual(['a']);
    expect(removeNodes(p, ['a', 'b']).groups).toEqual([]);
    const chain = flow({
      sources: [src({ id: 'cust', format: 'csv' })],
      nodes: [
        { id: 'in', type: 'source', sourceId: 'cust' },
        { id: 't1', type: 'transform', steps: [step('s1', 'trimWhitespace', { columns: ['name'] })] },
        { id: 't2', type: 'transform', steps: [step('s2', 'trimWhitespace', { columns: ['city'] })] },
      ],
      wires: [['in', 't1'], ['t1', 't2']],
    });
    expect(groupNodes(makeGroup(chain, ['in', 't2'], 'g1'), ['t1', 't2']).groups[0]!.nodeIds).toEqual(['in']);
  });

  it('a project file naming nodes that are gone opens with them left out', () => {
    const p = makeGroup(base(), ['a', 'b'], 'g1');
    const stale = { ...p, groups: [{ ...p.groups[0]!, nodeIds: ['a', 'gone'] }, { id: 'g2', name: 'Old', nodeIds: ['gone'], collapsed: true, position: { x: 0, y: 0 } }] };
    expect(parseProject(stale).groups).toEqual([{ ...p.groups[0]!, nodeIds: ['a'] }]);
  });
});
