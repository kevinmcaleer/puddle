import { describe, expect, it } from 'vitest';
import { flow, src, step } from '../../tests/helpers/projects';
import { inputEdges, outputEdges } from './graph';
import { placeStep } from './quickfix';
import type { Project } from './schema';

const base = (): Project =>
  flow({
    sources: [src({ id: 'cust', format: 'csv' })],
    nodes: [
      { id: 'in', type: 'source', sourceId: 'cust' },
      { id: 't', type: 'transform', steps: [step('a', 'trimWhitespace', { columns: ['name'] }), step('b', 'removeColumns', { columns: ['email'] })] },
      { id: 'out', type: 'output' },
    ],
    wires: [['in', 't'], ['t', 'out']],
  });
const view = (p: Project, viewedNodeId: string, viewedStepIndex?: number): Project => ({ ...p, view: { ...p.view, viewedNodeId, viewedStepIndex } });
const fix = step('fix', 'changeCase', { columns: ['name'], mode: 'upper' });

describe('placing a quick fix', () => {
  it('goes after the viewed step of a Transform, or at its end', () => {
    const atEnd = placeStep(view(base(), 't'), fix)!;
    expect(atEnd.stepIndex).toBe(2);
    const afterFirst = placeStep(view(base(), 't', 0), fix)!;
    expect(afterFirst).toMatchObject({ nodeId: 't', stepIndex: 1 });
    const t = afterFirst.project.nodes.find((n) => n.id === 't');
    expect(t?.type === 'transform' && t.steps.map((s) => s.id)).toEqual(['a', 'fix', 'b']);
  });

  it('on a Source, a new Transform goes between it and what it fed', () => {
    const placed = placeStep(view(base(), 'in'), fix, 'new')!;
    expect(placed).toMatchObject({ nodeId: 'new', stepIndex: 0 });
    expect(outputEdges(placed.project, 'in').map((e) => e.to.nodeId)).toEqual(['new']);
    expect(inputEdges(placed.project, 't').map((e) => e.from.nodeId)).toEqual(['new']);
  });

  it('on an Output, a new Transform goes between it and its input', () => {
    const placed = placeStep(view(base(), 'out'), fix, 'new')!;
    expect(inputEdges(placed.project, 'new').map((e) => e.from.nodeId)).toEqual(['t']);
    expect(inputEdges(placed.project, 'out').map((e) => e.from.nodeId)).toEqual(['new']);
    expect(placed.project.edges).toHaveLength(3);
  });

  it('does nothing when nothing is viewed', () => {
    expect(placeStep(base(), fix)).toBeUndefined();
  });
});
