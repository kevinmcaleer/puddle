import { describe, expect, it } from 'vitest';
import { flow, src } from '../../tests/helpers/projects';
import { compile } from './compile';
import { CompileError, UnwiredError } from './errors';
import { compileSqlNode, sqlInputNames, sqlNodeProblem, sqlTableNames } from './sqlNode';

const inputs = [
  { port: 0, cte: 'n_a', label: 'customers.csv' },
  { port: 1, cte: 'n_b', label: 'Transform 1' },
];

describe('the SQL node', () => {
  it('names each input by number and by its node, and a lone input as plain input too', () => {
    expect(sqlTableNames(inputs)).toEqual(['input1', 'customers.csv', 'input2', 'Transform 1']);
    expect(sqlInputNames({ port: 0, label: 'orders.tsv' }, 1)).toEqual(['input1', 'input', 'orders.tsv']);
    // A node called like a numbered input adds nothing.
    expect(sqlInputNames({ port: 2, label: 'input3' }, 3)).toEqual(['input3']);
  });

  it('lets the query read its inputs by any of those names, and nothing else', () => {
    expect(sqlNodeProblem({ query: 'SELECT * FROM input1 JOIN input2 USING (id)' }, inputs)).toBeUndefined();
    expect(sqlNodeProblem({ query: 'SELECT * FROM "customers.csv" c JOIN "Transform 1" t ON c.id = t.id' }, inputs)).toBeUndefined();
    expect(sqlNodeProblem({ query: 'SELECT * FROM input' }, inputs)).toMatch(/no table input .*use input1, customers.csv, input2, Transform 1/);
    expect(sqlNodeProblem({ query: "SELECT * FROM read_csv('x.csv')" }, inputs)).toMatch(/read_csv/);
    expect(sqlNodeProblem({ query: '' }, inputs)).toBe('write a query, such as SELECT * FROM input1');
  });

  it('binds the inputs as CTEs around the query, which runs as a subquery', () => {
    expect(compileSqlNode({ query: 'SELECT count(*) AS n FROM input1 -- rows\n' }, inputs)).toBe(
      'WITH "input1" AS (SELECT * FROM n_a), "customers.csv" AS (SELECT * FROM n_a), "input2" AS (SELECT * FROM n_b), "Transform 1" AS (SELECT * FROM n_b)\nSELECT * FROM (\nSELECT count(*) AS n FROM input1\n)',
    );
  });

  it('compiles inside a flow, and refuses a node with no wire or a query it can’t allow', () => {
    const a = src({ id: 'a', format: 'csv' });
    const b = src({ id: 'b', format: 'csv' });
    const project = flow({
      sources: [a, b],
      nodes: [
        { id: 'a', type: 'source', sourceId: 'a' },
        { id: 'b', type: 'source', sourceId: 'b' },
        { id: 'q', type: 'sql', sqlSpec: { query: 'SELECT a.id FROM input1 a JOIN input2 b USING (id)' } },
      ],
      wires: [
        ['a', 'q', 0],
        ['b', 'q', 1],
      ],
    });
    const { sql } = compile(project, { nodeId: 'q' });
    expect(sql).toContain('"input1" AS (SELECT * FROM');
    expect(sql).toContain('"b" AS (SELECT * FROM');
    expect(sql).toMatch(/SELECT \* FROM \(\nSELECT a\.id FROM input1 a JOIN input2 b USING \(id\)\n\)/);

    const unwired = { ...project, edges: [] };
    expect(() => compile(unwired, { nodeId: 'q' })).toThrow(UnwiredError);
    const bad = { ...project, nodes: project.nodes.map((n) => (n.type === 'sql' ? { ...n, sqlSpec: { query: "COPY input1 TO 'x.csv'" } } : n)) };
    expect(() => compile(bad, { nodeId: 'q' })).toThrow(CompileError);
  });
});
