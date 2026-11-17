import { flow, src } from '../../tests/helpers/projects';
import { sqlReads } from '../compiler';
import { inputEdges } from './graph';
import { setSqlAndWires, syncNamedWires } from './namedWires';
import type { Project } from './schema';

const base = (extra: Parameters<typeof flow>[0]['wires'] = []) =>
  flow({
    sources: [src({ id: 'docs', format: 'csv' }), src({ id: 'users', format: 'csv' })],
    nodes: [
      { id: 'docs', type: 'source', sourceId: 'docs' },
      { id: 'users', type: 'source', sourceId: 'users' },
      { id: 'q', type: 'sql' },
      { id: 'after', type: 'transform' },
    ],
    wires: [['q', 'after', 0], ...extra],
  });
const reads = (p: Project) => inputEdges(p, 'q').map((e) => [e.from.nodeId, e.to.port, !!e.byName]);

describe('the table names a query reads', () => {
  it('are every table it does not make itself, once each, in lower case', () => {
    expect(sqlReads('SELECT * FROM Docs d JOIN users u ON u.id = d.id JOIN docs x ON true')).toEqual(['docs', 'users']);
    expect(sqlReads('CREATE TABLE log AS SELECT * FROM input1;\nSELECT * FROM log JOIN users USING (id)')).toEqual(['input1', 'users']);
    expect(sqlReads('WITH big AS (SELECT * FROM docs) SELECT * FROM big')).toEqual(['docs']);
  });
});

describe('by-name wires', () => {
  it('are made for each node the query names, into the next free inputs, and say they are by name', () => {
    const p = setSqlAndWires(base(), 'q', 'SELECT * FROM docs JOIN Users USING (id)');
    expect(reads(p)).toEqual([
      ['docs', 0, true],
      ['users', 1, true],
    ]);
    // Committing the same query again adds nothing.
    expect(setSqlAndWires(p, 'q', 'SELECT * FROM docs JOIN Users USING (id)').edges).toEqual(p.edges);
  });

  it('go when the query stops naming their node, and stay while it reads the node as inputN', () => {
    const p = setSqlAndWires(base(), 'q', 'SELECT * FROM docs JOIN users USING (id)');
    expect(reads(setSqlAndWires(p, 'q', 'SELECT * FROM users'))).toEqual([['users', 1, true]]);
    expect(reads(setSqlAndWires(p, 'q', 'SELECT * FROM input1 JOIN users USING (id)'))).toEqual([
      ['docs', 0, true],
      ['users', 1, true],
    ]);
  });

  it('leave a wire drawn by hand alone, whatever the query reads', () => {
    const p = setSqlAndWires(base([['docs', 'q', 0]]), 'q', 'SELECT 1 AS one');
    expect(reads(p)).toEqual([['docs', 0, false]]);
    expect(reads(setSqlAndWires(p, 'q', 'SELECT * FROM docs JOIN users USING (id)'))).toEqual([
      ['docs', 0, false],
      ['users', 1, true],
    ]);
  });

  it('are not made for a node this one feeds, a name two nodes share, or a name no node has', () => {
    expect(reads(setSqlAndWires(base(), 'q', 'SELECT * FROM "after" JOIN nowhere ON true'))).toEqual([]);
    const twins = base();
    const shared = { ...twins, nodes: twins.nodes.map((n) => (n.id === 'users' ? { ...n, name: 'docs' } : n)) };
    expect(reads(setSqlAndWires(shared, 'q', 'SELECT * FROM docs'))).toEqual([]);
  });

  it('are not made while the query reads plain input, which a second table would break', () => {
    const p = setSqlAndWires(base([['docs', 'q', 0]]), 'q', 'SELECT * FROM input JOIN users USING (id)');
    expect(reads(p)).toEqual([['docs', 0, false]]);
  });

  it('only concern SQL nodes', () => {
    const p = base();
    expect(syncNamedWires(p, 'after', ['docs'])).toBe(p);
  });
});
