// INSERT, UPDATE, DELETE, ALTER TABLE and DROP TABLE in a SQL script on real DuckDB-WASM (Node build): each gives the
// table's rows as DuckDB's own statement would leave them (tests/fixtures/shop-orders.csv).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, sourceFileName } from '../../src/compiler';
import { EngineClient, tableColumns, tableRows } from '../../src/engine/client';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

const orders = src({ id: 'shop-orders', format: 'csv' });
const project = (query: string, table = 'sales') =>
  flow({
    sources: [orders],
    nodes: [
      { id: 'o', type: 'source', sourceId: orders.id, name: 'orders' },
      { id: 'script', type: 'sql', sqlSpec: { query } },
      { id: 't', type: 'scriptTable', scriptTable: { table } },
    ],
    wires: [
      ['o', 'script', 0],
      ['script', 't'],
    ],
  });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(orders), new Uint8Array(readFileSync(join(__dirname, `../fixtures/${orders.id}.csv`))));
});
afterAll(() => engine.close());

const plain = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));
const run = async (query: string, nodeId = 't', table?: string) => {
  const r = await engine.query(compile(project(query, table), { nodeId }).sql);
  return { rows: tableRows(r.table).map(plain), columns: tableColumns(r.table) };
};
const COPY = 'CREATE TABLE sales AS SELECT order_id, total, status FROM orders ORDER BY order_id;\n';

describe('changing a table in a script', () => {
  it('declares a table, inserts rows into it by position and by name, and keeps the declared types', async () => {
    const { rows, columns } = await run("CREATE TABLE sales (order_id INTEGER, note VARCHAR);\nINSERT INTO sales VALUES (1, 'first'), (2, 'second');\nINSERT INTO sales (note) VALUES ('no id')");
    expect(rows).toEqual([
      { order_id: 1, note: 'first' },
      { order_id: 2, note: 'second' },
      { order_id: null, note: 'no id' },
    ]);
    expect(columns.map((c) => c.type)).toEqual(['INTEGER', 'VARCHAR']);
  });

  it('updates only the rows the condition holds for, and deletes rows as DuckDB does (a null condition keeps the row)', async () => {
    const { rows } = await run(`${COPY}UPDATE sales SET status = upper(status) WHERE total > 9;\nDELETE FROM sales WHERE status = 'pending'`);
    expect(rows.map((r) => [r.order_id, r.status])).toEqual([
      [100, 'SHIPPED'],
      [102, 'shipped'],
      [103, 'SHIPPED'],
    ]);
    const nulls = await run("CREATE TABLE sales AS SELECT * FROM (VALUES (1, NULL), (2, 5)) AS v(id, n);\nDELETE FROM sales WHERE n > 1");
    expect(nulls.rows).toEqual([{ id: 1, n: null }]);
  });

  it('adds, drops, renames and retypes columns', async () => {
    const { rows, columns } = await run(`${COPY}ALTER TABLE sales ADD COLUMN currency VARCHAR DEFAULT 'GBP';\nALTER TABLE sales DROP COLUMN status;\nALTER TABLE sales RENAME COLUMN total TO amount;\nALTER TABLE sales ALTER COLUMN amount TYPE INTEGER`);
    expect(columns).toEqual([
      { name: 'order_id', type: 'BIGINT' },
      { name: 'amount', type: 'INTEGER' },
      { name: 'currency', type: 'VARCHAR' },
    ]);
    // 12.50 becomes 12, as DuckDB's ALTER COLUMN ... TYPE INTEGER casts it.
    expect(rows[0]).toEqual({ order_id: 100, amount: 12, currency: 'GBP' });
  });

  it('renames a table, and drops one so the script’s rows are the last table left', async () => {
    expect((await run('CREATE TABLE draft AS SELECT order_id FROM orders;\nALTER TABLE draft RENAME TO sales')).rows).toHaveLength(5);
    const { rows } = await run(`${COPY}CREATE TABLE scratch AS SELECT 1 AS x;\nDROP TABLE scratch`, 'script');
    expect(rows).toHaveLength(5);
  });

  it('reads each table at its latest version, wherever a later statement reads it', async () => {
    const { rows } = await run(`${COPY}DELETE FROM sales WHERE status <> 'shipped';\nSELECT count(*) AS n FROM sales`, 'script');
    expect(rows).toEqual([{ n: 3 }]);
  });
});
