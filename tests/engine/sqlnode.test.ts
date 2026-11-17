// The SQL node on real DuckDB-WASM (Node build) against tests/fixtures: two inputs joined by hand-written SQL.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileCount, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createNodeBackend } from '../helpers/nodeBackend';
import { renameNode, setSqlAndWires } from '../../src/model';
import { flow, src } from '../helpers/projects';

const customers = src({ id: 'shop-customers', format: 'csv' });
const orders = src({ id: 'shop-orders', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  for (const s of [customers, orders]) await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, `../fixtures/${s.id}.csv`))));
});
afterAll(() => engine.close());

const project = (query: string) =>
  flow({
    sources: [customers, orders],
    nodes: [
      { id: 'c', type: 'source', sourceId: customers.id },
      { id: 'o', type: 'source', sourceId: orders.id },
      { id: 'q', type: 'sql', sqlSpec: { query } },
    ],
    wires: [
      ['c', 'q', 0],
      ['o', 'q', 1],
    ],
  });

describe('a SQL node', () => {
  it('joins its inputs by number or by node name and returns the rows', async () => {
    const byNumber = (await engine.query(compile(project('SELECT c.customer_id, count(*) AS orders FROM input1 c JOIN input2 o USING (customer_id) GROUP BY 1 ORDER BY 1'), { nodeId: 'q' }).sql)).table;
    const byName = (await engine.query(compile(project('SELECT c.customer_id, count(*) AS orders FROM c JOIN o USING (customer_id) GROUP BY 1 ORDER BY 1'), { nodeId: 'q' }).sql)).table;
    expect(tableRows(byNumber)).toEqual(tableRows(byName));
    expect(tableRows(byNumber).length).toBeGreaterThan(0);
    expect(Object.keys(tableRows(byNumber)[0]!)).toEqual(['customer_id', 'orders']);
  });

  it('counts like any other node', async () => {
    const n = tableRows((await engine.query(compileCount(project('SELECT * FROM input2'), { nodeId: 'q' }))).table)[0]!.n;
    expect(Number(n)).toBeGreaterThan(0);
  });

  // Regression (#270): renaming a node left SQL reading it by its old name, which then had no such table.
  it('goes on running, with the same rows, when a node it reads by name is renamed', async () => {
    const before = project('SELECT c.customer_id, o.total FROM c JOIN o ON o.customer_id = c.customer_id WHERE o.total > 0 ORDER BY 1, 2');
    const after = renameNode(renameNode(before, 'o', 'Shop orders'), 'c', 'customers');
    const sql = after.nodes.find((n) => n.id === 'q');
    expect(sql?.type === 'sql' && sql.sqlSpec.query).toBe('SELECT customers.customer_id, "Shop orders".total FROM customers JOIN "Shop orders" ON "Shop orders".customer_id = customers.customer_id WHERE "Shop orders".total > 0 ORDER BY 1, 2');
    const rows = async (p: typeof before) => tableRows((await engine.query(compile(p, { nodeId: 'q' }).sql)).table);
    expect(await rows(after)).toEqual(await rows(before));
    expect((await rows(after)).length).toBeGreaterThan(0);
  });
});

describe('a SQL node that names tables it is not wired to', () => {
  it('is wired to them when its query is set, and returns the same rows as the hand-wired query', async () => {
    const loose = { ...project(''), edges: [] };
    const sql = 'SELECT c.customer_id, count(*) AS orders FROM c JOIN o USING (customer_id) GROUP BY 1 ORDER BY 1';
    const named = setSqlAndWires(loose, 'q', sql);
    expect(named.edges.map((e) => [e.from.nodeId, e.byName])).toEqual([
      ['c', true],
      ['o', true],
    ]);
    const rows = tableRows((await engine.query(compile(named, { nodeId: 'q' }).sql)).table);
    expect(rows).toEqual(tableRows((await engine.query(compile(project(sql), { nodeId: 'q' }).sql)).table));
    expect(rows.length).toBeGreaterThan(0);
  });
});
