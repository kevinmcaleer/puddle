import { beforeEach, describe, expect, it } from 'vitest';
import { flow, src } from '../../tests/helpers/projects';
import { useSession } from '../app/session';
import { nodeById, outputEdges, useProjectStore, type OutputNode } from '../model';
import { outputFor } from './run';

const present = () => useProjectStore.getState().history.present;
const output = (id: string) => nodeById(present(), id) as OutputNode;

beforeEach(() => {
  useProjectStore.getState().load(
    flow({
      sources: [src({ id: 's', format: 'csv', name: 'sales.csv' })],
      nodes: [
        { id: 'a', type: 'source', sourceId: 's' },
        { id: 't', type: 'transform' },
      ],
      wires: [['a', 't']],
    }),
  );
  useSession.setState({ selectedNodeId: null, selectedNodeIds: [] });
});

describe('the Output a node exports through', () => {
  it('is added after the node as one undo step, named after the data, selected and viewed', () => {
    const id = outputFor('t', 'parquet')!;
    expect(output(id).type).toBe('output');
    expect(output(id).outputSpec).toMatchObject({ format: 'parquet', fileName: 'sales-clean' });
    expect(outputEdges(present(), 't').map((e) => e.to.nodeId)).toEqual([id]);
    expect(useSession.getState().selectedNodeId).toBe(id);
    expect(present().view.viewedNodeId).toBe(id);
    useProjectStore.getState().undo();
    expect(present().nodes.map((n) => n.id)).toEqual(['a', 't']);
  });

  it('is the one already there the next time, switched to the format asked for', () => {
    const first = outputFor('t')!;
    expect(output(first).outputSpec.format).toBe('csv');
    expect(outputFor('t', 'xlsx')).toBe(first);
    expect(output(first).outputSpec).toMatchObject({ format: 'xlsx', fileName: 'sales-clean' });
    expect(present().nodes.filter((n) => n.type === 'output')).toHaveLength(1);
  });

  it('is an Output node itself, left where it is', () => {
    const id = outputFor('t')!;
    const before = present();
    expect(outputFor(id)).toBe(id);
    expect(present()).toBe(before);
  });

  it('is nothing for a node that isn’t there', () => {
    expect(outputFor('nope')).toBeUndefined();
  });
});
