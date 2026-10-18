import { describe, expect, it } from 'vitest';
import { flow, src, step } from '../../tests/helpers/projects';
import { groupOf, inputEdges, outputEdges, type TransformNode } from '../model';
import { insertTemplate, insertTemplateChain } from './insert';

const base = () =>
  flow({
    sources: [src({ id: 'cust', format: 'csv' })],
    nodes: [{ id: 'in', type: 'source', sourceId: 'cust' }],
    wires: [],
  });

const steps = () => [step('s1', 'trimWhitespace', { columns: ['name'] }), step('s2', 'changeCase', { columns: ['name'], mode: 'title' }), step('s3', 'removeBlankRows', { columns: ['name'] })];

describe('inserting a template', () => {
  it('as one node: a Transform named after the template, wired after the feed, holding every step', () => {
    const p = insertTemplate(base(), 'Tidy names', steps(), { x: 300, y: 0 }, 'in', 'n1');
    const node = p.nodes.find((n) => n.id === 'n1') as TransformNode;
    expect(node.name).toBe('Tidy names');
    expect(node.steps.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(inputEdges(p, 'n1').map((e) => e.from.nodeId)).toEqual(['in']);
    expect(p.groups).toEqual([]);
  });

  it('as a chain: one Transform per step, wired one after another in a line, in a group named after the template', () => {
    const p = insertTemplateChain(base(), 'Tidy names', steps(), { x: 300, y: 40 }, 'in', ['n1', 'n2', 'n3'], 'g1');
    const chain = ['n1', 'n2', 'n3'].map((id) => p.nodes.find((n) => n.id === id) as TransformNode);
    expect(chain.map((n) => n.name)).toEqual(['Transform 1', 'Transform 2', 'Transform 3']);
    expect(chain.map((n) => n.steps.map((s) => s.id))).toEqual([['s1'], ['s2'], ['s3']]);
    expect(chain.map((n) => n.position)).toEqual([
      { x: 300, y: 40 },
      { x: 596, y: 40 },
      { x: 892, y: 40 },
    ]);
    expect(inputEdges(p, 'n1').map((e) => e.from.nodeId)).toEqual(['in']);
    expect(outputEdges(p, 'n1').map((e) => e.to.nodeId)).toEqual(['n2']);
    expect(outputEdges(p, 'n2').map((e) => e.to.nodeId)).toEqual(['n3']);
    expect(outputEdges(p, 'n3')).toEqual([]);
    expect(p.groups).toEqual([{ id: 'g1', name: 'Tidy names', nodeIds: ['n1', 'n2', 'n3'], collapsed: true, position: { x: 300, y: 40 } }]);
    expect(groupOf(p, 'n2')?.name).toBe('Tidy names');
  });

  it('a second copy takes the next free name, and a one-step template is one node with no group', () => {
    let p = insertTemplateChain(base(), 'Tidy names', steps(), { x: 300, y: 0 }, 'in', ['n1', 'n2', 'n3'], 'g1');
    p = insertTemplateChain(p, 'Tidy names', steps(), { x: 300, y: 200 }, 'in', ['n4', 'n5', 'n6'], 'g2');
    expect(p.groups.map((g) => g.name)).toEqual(['Tidy names', 'Tidy names 2']);
    const one = insertTemplateChain(base(), 'Trim', steps().slice(0, 1), { x: 300, y: 0 }, 'in', ['n1'], 'g1');
    expect(one.groups).toEqual([]);
    expect(one.nodes.find((n) => n.id === 'n1')).toMatchObject({ name: 'Trim', steps: [{ id: 's1' }] });
  });
});
