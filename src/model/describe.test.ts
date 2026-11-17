import { describe, expect, it } from 'vitest';
import { flow, src, step } from '../../tests/helpers/projects';
import { cleanDescription, DESCRIPTION_MAX, setGroupDescription, setNodeDescription } from './describe';
import { makeGroup } from './groups';
import type { Project } from './schema';
import { groupNodes, splitNode, ungroupNode } from './steps';

const trim = (id: string) => step(id, 'trimWhitespace', { columns: ['name'] });

// in → a → b → out
const line = (): Project =>
  flow({
    sources: [src({ id: 'cust', format: 'csv' })],
    nodes: [
      { id: 'in', type: 'source', sourceId: 'cust' },
      { id: 'a', type: 'transform', steps: [trim('s1')] },
      { id: 'b', type: 'transform', steps: [trim('s2')] },
      { id: 'out', type: 'output' },
    ],
    wires: [['in', 'a'], ['a', 'b'], ['b', 'out']],
  });

const node = (p: Project, id: string) => p.nodes.find((n) => n.id === id)!;

describe('descriptions', () => {
  it('keep one line: spaces collapsed, trimmed, cut to the longest kept, and nothing when blank', () => {
    expect(cleanDescription('  combine   into\na single\tlist  ')).toBe('combine into a single list');
    expect(cleanDescription('x'.repeat(DESCRIPTION_MAX + 20))).toHaveLength(DESCRIPTION_MAX);
    expect(cleanDescription(`${'a'.repeat(DESCRIPTION_MAX - 1)} b`)).toBe('a'.repeat(DESCRIPTION_MAX - 1));
    expect(cleanDescription('   \n ')).toBeUndefined();
    expect(cleanDescription(undefined)).toBeUndefined();
  });

  it('describe a node, change it and clear it, leaving every other node alone', () => {
    let p = setNodeDescription(line(), 'a', ' combine into a single list ');
    expect(node(p, 'a').description).toBe('combine into a single list');
    expect(p.nodes.filter((n) => n.id !== 'a').every((n) => n.description === undefined)).toBe(true);
    p = setNodeDescription(p, 'a', 'touchless rate per month');
    expect(node(p, 'a').description).toBe('touchless rate per month');
    p = setNodeDescription(p, 'a', '  ');
    expect(node(p, 'a').description).toBeUndefined();
  });

  it('leave the project as it is when nothing changes or the node is gone', () => {
    const p = setNodeDescription(line(), 'a', 'combine');
    expect(setNodeDescription(p, 'a', ' combine ')).toBe(p);
    expect(setNodeDescription(p, 'missing', 'x')).toBe(p);
    expect(setGroupDescription(p, 'missing', 'x')).toBe(p);
  });

  it('describe a group and clear it', () => {
    let p = makeGroup(line(), ['a', 'b'], 'g1');
    p = setGroupDescription(p, 'g1', 'tidy the customer names');
    expect(p.groups[0]!.description).toBe('tidy the customer names');
    expect(setGroupDescription(p, 'g1', 'tidy the customer names')).toBe(p);
    expect(setGroupDescription(p, 'g1', '').groups[0]!.description).toBeUndefined();
  });

  it('come back with each node when merged nodes are split again', () => {
    let p = setNodeDescription(line(), 'a', 'trim names');
    p = setNodeDescription(p, 'b', 'trim names again');
    const merged = groupNodes(p, ['a', 'b']);
    expect(merged.nodes.map((n) => n.id)).not.toContain('b');
    expect(node(merged, 'a').description).toBe('trim names');
    expect(node(ungroupNode(merged, 'a'), 'b').description).toBe('trim names again');
    expect(node(splitNode(merged, 'a', 1), 'b').description).toBe('trim names again');
  });
});
