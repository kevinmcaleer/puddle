import { describe, expect, it } from 'vitest';
import { flow, src, step } from '../../tests/helpers/projects';
import { removeNodes } from './edits';
import { canMakeGroup, chainAround, groupOf, groupPorts, makeGroup, moveGroup, renameGroup, setGroupCollapsed, ungroup } from './groups';
import { parseProject } from './project';
import type { Project } from './schema';
import { groupNodes, splitNode, ungroupNode } from './steps';

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
    // Nothing was in the way, so nothing moved.
    expect(p.nodes).toEqual(base().nodes);
    p = renameGroup(p, 'g1', '  Clean up  ');
    expect(p.groups[0]!.name).toBe('Clean up');
    expect(renameGroup(p, 'g1', ' ')).toBe(p);
    expect(ungroup(p, 'g1').groups).toEqual([]);
  });

  it('opening a group moves what was laid out where its nodes are further right, keeping the flow\'s shape', () => {
    // As Auto layout leaves it with in and a grouped: the join where a is, the output one step on.
    const closed = makeGroup(base(), ['in', 'a'], 'g1');
    const at = (p: Project, id: string) => p.nodes.find((n) => n.id === id)!.position;
    const laidOut = { ...closed, nodes: closed.nodes.map((n) => (n.id === 'b' ? { ...n, position: { x: 300, y: 0 } } : n.id === 'out' ? { ...n, position: { x: 600, y: 0 } } : n)) };
    const open = setGroupCollapsed(laidOut, 'g1', false);
    // a's right edge (300 + 232) plus room: b moves from 300 to 596, and out by the same.
    expect(at(open, 'b')).toEqual({ x: 596, y: 0 });
    expect(at(open, 'out')).toEqual({ x: 896, y: 0 });
    // The group's own nodes, and side (level with the group's left edge), stay put.
    expect(['in', 'a', 'side'].map((id) => at(open, id))).toEqual(['in', 'a', 'side'].map((id) => at(laidOut, id)));
    // Closing moves nothing back, and opening again finds the room already there.
    const again = setGroupCollapsed(setGroupCollapsed(open, 'g1', true), 'g1', false);
    expect(again.nodes).toEqual(open.nodes);
  });

  it('opening a group moves another collapsed group in its way as a whole', () => {
    let p = makeGroup(base(), ['in', 'a'], 'g1');
    p = makeGroup(p, ['b', 'out'], 'g2');
    p = moveGroup(p, 'g2', { x: 300, y: 100 });
    const open = setGroupCollapsed(p, 'g1', false);
    expect(open.groups.find((g) => g.id === 'g2')!.position).toEqual({ x: 596, y: 100 });
    expect(open.nodes.filter((n) => ['b', 'out'].includes(n.id)).map((n) => n.position)).toEqual([
      { x: 596, y: 100 },
      { x: 896, y: 100 },
    ]);
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

  // in → t1 → t2 → t3 → out, with t3 also feeding a second output: a chain of three Transforms.
  const line = (): Project =>
    flow({
      sources: [src({ id: 'cust', format: 'csv' })],
      nodes: [
        { id: 'in', type: 'source', sourceId: 'cust' },
        { id: 't1', type: 'transform', steps: [step('s1', 'trimWhitespace', { columns: ['name'] })] },
        { id: 't2', type: 'transform', steps: [step('s2', 'trimWhitespace', { columns: ['city'] })] },
        { id: 't3', type: 'transform', steps: [step('s3', 'removeBlankRows', { columns: ['name'] })] },
        { id: 'out', type: 'output' },
        { id: 'out2', type: 'output' },
      ],
      wires: [['in', 't1'], ['t1', 't2'], ['t2', 't3'], ['t3', 'out'], ['t3', 'out2']],
    });

  it('the chain round a node is the run of Transforms wired one after another through it, in order', () => {
    expect(chainAround(line(), 't2')).toEqual(['t1', 't2', 't3']);
    expect(chainAround(line(), 't1')).toEqual(['t1', 't2', 't3']);
    expect(chainAround(line(), 't3')).toEqual(['t1', 't2', 't3']);
    // Not a Transform: no chain. A source or an output is never part of one.
    expect(chainAround(line(), 'in')).toEqual([]);
    expect(chainAround(line(), 'out')).toEqual([]);
  });

  it('the chain stops at a branch, a node already in a group, and a node with more than one input', () => {
    // t1 branches to t2 and a second output: the chain from t2 cannot reach back through it.
    const branched = flow({
      sources: [src({ id: 'cust', format: 'csv' })],
      nodes: line().nodes.map((n) => ({ ...n })) as never,
      wires: [['in', 't1'], ['t1', 't2'], ['t1', 'out2'], ['t2', 't3'], ['t3', 'out']],
    });
    expect(chainAround(branched, 't2')).toEqual(['t2', 't3']);
    expect(chainAround(branched, 't1')).toEqual(['t1']);
    expect(chainAround(makeGroup(line(), ['t3', 'out'], 'g1'), 't1')).toEqual(['t1', 't2']);
    // The join b takes two inputs, so a's chain is a alone.
    expect(chainAround(base(), 'a')).toEqual(['a']);
  });

  it('a group stays the bundle when its nodes are merged into one and split again', () => {
    let p = makeGroup(line(), ['t1', 't2', 't3'], 'g1');
    p = groupNodes(p, ['t1', 't2', 't3']);
    expect(p.nodes.map((n) => n.id)).toEqual(['in', 't1', 'out', 'out2']);
    expect(p.groups[0]!.nodeIds).toEqual(['t1']);
    const back = ungroupNode(p, 't1');
    expect(back.groups[0]!.nodeIds).toEqual(['t1', 't2', 't3']);
    expect(back.nodes.map((n) => n.id).sort()).toEqual(line().nodes.map((n) => n.id).sort());
    // Splitting a grouped node by hand keeps the new node in the group too (t2 comes back holding the rest).
    expect(splitNode(p, 't1', 1).groups[0]!.nodeIds).toEqual(['t1', 't2']);
  });

  it('a project file naming nodes that are gone opens with them left out', () => {
    const p = makeGroup(base(), ['a', 'b'], 'g1');
    const stale = { ...p, groups: [{ ...p.groups[0]!, nodeIds: ['a', 'gone'] }, { id: 'g2', name: 'Old', nodeIds: ['gone'], collapsed: true, position: { x: 0, y: 0 } }] };
    expect(parseProject(stale).groups).toEqual([{ ...p.groups[0]!, nodeIds: ['a'] }]);
  });
});
