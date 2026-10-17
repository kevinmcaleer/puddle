// The SQL node on real DuckDB-WASM (Node build) against tests/fixtures: two inputs joined by hand-written SQL.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileCount, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createNodeBackend } from '../helpers/nodeBackend';
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
});
