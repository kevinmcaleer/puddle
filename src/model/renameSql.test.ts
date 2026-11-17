import { describe, expect, it } from 'vitest';
import { flow, src } from '../../tests/helpers/projects';
import type { Project } from './schema';
import { renameNode } from './steps';

const sources = [src({ id: 's1', format: 'csv' }), src({ id: 's2', format: 'csv' })];

/** Two sources, named sales.csv and customers, wired into a SQL node and into a Query that keeps SQL. */
const project = (query: string, kept = query) =>
  flow({
    sources,
    nodes: [
      { id: 'a', type: 'source', sourceId: 's1', name: 'sales.csv' },
      { id: 'b', type: 'source', sourceId: 's2', name: 'customers' },
      { id: 'q', type: 'sql', sqlSpec: { query } },
      { id: 'd', type: 'query', querySpec: { sql: kept } },
      { id: 'alone', type: 'sql', sqlSpec: { query } },
    ],
    wires: [
      ['a', 'q', 0],
      ['b', 'q', 1],
      ['a', 'd', 0],
      ['b', 'd', 1],
      ['b', 'alone', 0],
    ],
  });

const sqlOf = (p: Project, id: string) => {
  const n = p.nodes.find((x) => x.id === id)!;
  return n.type === 'sql' ? n.sqlSpec.query : n.type === 'query' ? n.querySpec.sql : undefined;
};

describe('renaming a node that SQL reads by name', () => {
  it('rewrites the name in the SQL nodes and kept Query SQL wired from it, and nowhere else', () => {
    const p = renameNode(project('SELECT * FROM "sales.csv" JOIN customers USING (id)'), 'a', 'sales');
    expect(sqlOf(p, 'q')).toBe('SELECT * FROM sales JOIN customers USING (id)');
    expect(sqlOf(p, 'd')).toBe('SELECT * FROM sales JOIN customers USING (id)');
    // Not wired from the renamed node: its "sales.csv" was never that node.
    expect(sqlOf(p, 'alone')).toBe('SELECT * FROM "sales.csv" JOIN customers USING (id)');
  });

  it('leaves SQL that reads the node by number as it is, returning the same nodes', () => {
    const before = project('SELECT * FROM input1 JOIN input2 USING (id)');
    const after = renameNode(before, 'a', 'sales');
    for (const id of ['q', 'd', 'alone', 'b']) expect(after.nodes.find((n) => n.id === id)).toBe(before.nodes.find((n) => n.id === id));
  });

  it('falls back to the numbered name when the SQL already uses the new name', () => {
    const p = renameNode(project('WITH big AS (SELECT * FROM "sales.csv") SELECT * FROM big'), 'a', 'big');
    expect(sqlOf(p, 'q')).toBe('WITH big AS (SELECT * FROM input1) SELECT * FROM big');
  });

  it('falls back to the numbered name when the new name cannot name the input', () => {
    // input2 is the other input's numbered name, so the node can't be read by it.
    expect(sqlOf(renameNode(project('SELECT * FROM "sales.csv"'), 'a', 'input2'), 'q')).toBe('SELECT * FROM input1');
    // A Query doesn't offer a name two of its tables share.
    const shared = renameNode(project('SELECT * FROM "sales.csv"'), 'a', 'Customers');
    expect(sqlOf(shared, 'd')).toBe('SELECT * FROM input1');
  });

  it('follows a change of capitals only', () => {
    expect(sqlOf(renameNode(project('SELECT * FROM customers'), 'b', 'Customers'), 'alone')).toBe('SELECT * FROM Customers');
  });

  it('is one edit, so one undo step restores name and SQL together', () => {
    const before = project('SELECT * FROM "sales.csv"');
    const after = renameNode(before, 'a', 'sales');
    expect(after.nodes.find((n) => n.id === 'a')!.name).toBe('sales');
    expect(sqlOf(before, 'q')).toBe('SELECT * FROM "sales.csv"');
  });
});
