import { describe, expect, it } from 'vitest';
import { flow, src, step } from '../../tests/helpers/projects';
import { placeFixes } from './fixes';
import { inputEdges, outputEdges } from './graph';
import type { Project } from './schema';

const base = (): Project =>
  flow({
    sources: [src({ id: 'cust', format: 'csv' })],
    nodes: [
      { id: 'in', type: 'source', sourceId: 'cust' },
      { id: 't', type: 'transform', steps: [step('a', 'removeColumns', { columns: ['email'] })] },
    ],
    wires: [['in', 't']],
  });
const steps = [step('f1', 'removeNonPrinting', { columns: ['name'] }), step('f2', 'trimWhitespace', { columns: ['name', 'city'] }), step('f3', 'duplicateRows', { columns: [], keep: 'first' })];

describe('placing Fix all’s steps', () => {
  it('with steps as nodes, chains a Transform per step after the source, before what it fed, grouped as Fixes', () => {
    const placed = placeFixes(base(), 'in', steps, { nodes: ['n1', 'n2', 'n3'], group: 'g' })!;
    expect(placed.nodeIds).toEqual(['n1', 'n2', 'n3']);
    expect(placed.last).toMatchObject({ nodeId: 'n3', stepIndex: 0 });
    const { project } = placed;
    expect(outputEdges(project, 'in').map((e) => e.to.nodeId)).toEqual(['n1']);
    expect(outputEdges(project, 'n1').map((e) => e.to.nodeId)).toEqual(['n2']);
    expect(outputEdges(project, 'n2').map((e) => e.to.nodeId)).toEqual(['n3']);
    expect(inputEdges(project, 't').map((e) => e.from.nodeId)).toEqual(['n3']);
    expect(project.groups).toEqual([expect.objectContaining({ id: 'g', name: 'Fixes', nodeIds: ['n1', 'n2', 'n3'], collapsed: true })]);
    const names = project.nodes.filter((n) => n.type === 'transform' && n.steps[0]?.id.startsWith('f')).map((n) => n.type === 'transform' && n.steps.map((s) => s.type));
    expect(names).toEqual([['removeNonPrinting'], ['trimWhitespace'], ['duplicateRows']]);
  });

  it('with steps stacked, puts them in one new Transform after the source, in order, with no group', () => {
    const p: Project = { ...base(), settings: { ...base().settings, stepsAsNodes: false } };
    const placed = placeFixes(p, 'in', steps, { nodes: ['n1'] })!;
    expect(placed.nodeIds).toEqual(['n1']);
    expect(placed.last).toMatchObject({ nodeId: 'n1', stepIndex: 2 });
    const n1 = placed.project.nodes.find((n) => n.id === 'n1');
    expect(n1?.type === 'transform' && n1.steps.map((s) => s.id)).toEqual(['f1', 'f2', 'f3']);
    expect(placed.project.groups).toEqual([]);
  });

  it('one step makes one node and no group; no steps or an unknown node place nothing', () => {
    const one = placeFixes(base(), 'in', steps.slice(0, 1), { nodes: ['n1'] })!;
    expect(one.nodeIds).toEqual(['n1']);
    expect(one.project.groups).toEqual([]);
    expect(placeFixes(base(), 'in', [])).toBeUndefined();
    expect(placeFixes(base(), 'nope', steps)).toBeUndefined();
  });

  it('on a Transform that already has steps, the chain continues after it', () => {
    const placed = placeFixes(base(), 't', steps.slice(0, 2), { nodes: ['n1', 'n2'], group: 'g' })!;
    expect(outputEdges(placed.project, 't').map((e) => e.to.nodeId)).toEqual(['n1']);
    expect(outputEdges(placed.project, 'n1').map((e) => e.to.nodeId)).toEqual(['n2']);
    expect(placed.project.groups[0]).toMatchObject({ name: 'Fixes', nodeIds: ['n1', 'n2'] });
  });
});
