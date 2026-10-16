import { flow, src } from '../../tests/helpers/projects';
import type { QueryNode } from '../model';
import { designerTables, refKey, tableCandidates } from './tables';

const p = flow({
  sources: [src({ id: 'a', format: 'csv' })],
  nodes: [
    { id: 'cust', type: 'source', sourceId: 'a' },
    { id: 'ord', type: 'source', sourceId: 'a' },
    { id: 'q', type: 'query', querySpec: { tables: [{ port: 1, x: 400, y: 80 }] } },
    { id: 'out', type: 'output' },
    { id: 't', type: 'transform' },
  ],
  wires: [['cust', 'q', 0], ['ord', 'q', 1], ['q', 't'], ['t', 'out']],
});
const q = p.nodes.find((n) => n.id === 'q') as QueryNode;

describe('designer tables', () => {
  it('lists the wired inputs with their columns, where they were placed or side by side', () => {
    const tables = designerTables(p, q, {
      cust: { status: { state: 'ok', columns: [{ name: 'id', type: 'BIGINT' }] } },
      ord: { status: { state: 'error', message: 'Bad file' } },
    });
    expect(tables).toEqual([
      { port: 0, fromId: 'cust', label: 'cust', columns: [{ name: 'id', type: 'BIGINT' }], problem: undefined, x: 24, y: 24 },
      { port: 1, fromId: 'ord', label: 'ord', columns: undefined, problem: 'Bad file', x: 400, y: 80 },
    ]);
  });

  it('offers any node with an output that the query doesn’t feed', () => {
    expect(tableCandidates(p, 'q').map((n) => n.id)).toEqual(['cust', 'ord']);
  });

  it('keys fields by input and column', () => expect(refKey({ port: 2, column: 'id' })).toBe('2:id'));
});
