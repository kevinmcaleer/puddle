// Query nodes on real DuckDB-WASM (Node build): shop customers and orders joined by the lines the designer draws,
// with the grid's fields, aliases, criteria, sorting and unique values.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileDisplayPage, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { evaluateFlow, invalidateCaches, schemaCacheFor, useFlowStore } from '../../src/flow/status';
import { addQueryField, addQueryJoin, addQueryTable, removeQueryTable, setQueryJoinKind, updateQueryField, type Project, type QueryField, type QueryJoinKind } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

const customers = src({ id: 'customers', format: 'csv', name: 'shop-customers.csv' });
const orders = src({ id: 'orders', format: 'csv', name: 'shop-orders.csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  for (const [s, file] of [[customers, 'shop-customers.csv'], [orders, 'shop-orders.csv']] as const)
    await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, '../fixtures', file))));
});
afterAll(() => engine.close());
beforeEach(() => invalidateCaches());

/** Customers (input 1) and orders (input 2) in a Query, joined customer_id to customer_id, then an Output. */
function shop(kind: QueryJoinKind = 'inner', fields: Array<[port: number, column: string, patch?: Partial<QueryField>]> = [[1, 'order_id', { sort: 'asc' }], [0, 'name'], [1, 'total']]): Project {
  let p = flow({
    sources: [customers, orders],
    nodes: [
      { id: 'c', type: 'source', sourceId: 'customers' },
      { id: 'o', type: 'source', sourceId: 'orders' },
      { id: 'q', type: 'query' },
      { id: 'out', type: 'output' },
    ],
    wires: [['q', 'out']],
  });
  p = addQueryTable(p, 'q', 'c');
  p = addQueryTable(p, 'q', 'o');
  p = addQueryJoin(p, 'q', { port: 0, column: 'customer_id' }, { port: 1, column: 'customer_id' }, 'j1');
  p = setQueryJoinKind(p, 'q', 'j1', kind);
  fields.forEach(([port, column, patch], i) => {
    p = addQueryField(p, 'q', { port, column }, undefined, `f${i}`);
    if (patch) p = updateQueryField(p, 'q', `f${i}`, patch);
  });
  return p;
}

async function run(p: Project, nodeId = 'out') {
  const schema = await schemaCacheFor(engine).get(p, { nodeId });
  const columns = schema.map((c) => c.name);
  const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId }, columns, 0))).table).map((r) => columns.map((c) => r[c] ?? null));
  return { columns, types: schema.map((c) => c.type), rows };
}

describe('query joins', () => {
  it('matching rows only: each order with its customer, a customer id that repeats giving two rows', async () => {
    const { columns, types, rows } = await run(shop());
    expect(columns).toEqual(['order_id', 'name', 'total']);
    expect(types).toEqual(['BIGINT', 'VARCHAR', 'DOUBLE']);
    expect(rows.map((r) => `${r[0]} ${r[1]}`).sort()).toEqual(['100 Ada', '101 Grace', '102 Ada', '104 Barbara', '104 Barbara L']);
  });

  it('every row of orders keeps the order whose customer is missing', async () => {
    // The line runs customers to orders, so "every row of the second table" is a RIGHT JOIN.
    const { rows } = await run(shop('right'));
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r[0] === '103')).toEqual(['103', null, '9.99']);
  });

  it('every row of customers keeps the customer with no orders', async () => {
    const { rows } = await run(shop('left'));
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r[1] === 'Edsger')).toEqual([null, 'Edsger', null]);
  });

  it('every row of both tables', async () => {
    expect((await run(shop('full'))).rows).toHaveLength(7);
  });

  it('two tables with no line pair every row with every row', async () => {
    let p = shop();
    p = { ...p, nodes: p.nodes.map((n) => (n.type === 'query' ? { ...n, querySpec: { ...n.querySpec, joins: [] } } : n)) };
    expect((await run(p)).rows).toHaveLength(25);
  });
});

describe('query grid', () => {
  it('sorts, renames and filters, with hidden fields still filtering', async () => {
    const p = shop('inner', [
      [0, 'name', { alias: 'Customer', sort: 'asc' }],
      [1, 'total', { sort: 'desc' }],
      [1, 'status', { show: false, criteria: { op: '=', value: 'shipped' } }],
    ]);
    const { columns, rows } = await run(p);
    expect(columns).toEqual(['Customer', 'total']);
    expect(rows).toEqual([
      ['Ada', '12.5'],
      ['Ada', '3.25'],
    ]);
  });

  it.each([
    ['>', '5', ['100', '101']],
    ['<=', '3.25', ['102', '104', '104']],
    ['contains', 'BARB', ['104', '104']],
    ['starts', 'g', ['101']],
    ['ends', ' l', ['104']],
    ['<>', '8', ['100', '102', '104', '104']],
  ] as const)('criteria %s %s', async (op, value, ids) => {
    const column = op === 'contains' || op === 'starts' || op === 'ends' ? 'name' : 'total';
    const p = shop('inner', [[1, 'order_id', { sort: 'asc' }], [column === 'name' ? 0 : 1, column, { show: false, criteria: { op, value } }]]);
    expect((await run(p)).rows.map((r) => r[0])).toEqual(ids);
  });

  it('empty and not empty, on a left join’s missing values', async () => {
    const empty = shop('left', [[0, 'name', { sort: 'asc' }], [1, 'order_id', { criteria: { op: 'empty', value: '' } }]]);
    expect((await run(empty)).rows).toEqual([['Edsger', null]]);
    const filled = shop('left', [[0, 'name'], [1, 'order_id', { criteria: { op: 'notEmpty', value: '' } }]]);
    expect((await run(filled)).rows).toHaveLength(5);
  });

  it('* brings every column of a table, numbering names the other table already has', async () => {
    const { columns } = await run(shop('inner', [[0, '*'], [1, '*']]));
    expect(columns).toEqual(['customer_id', 'name', 'status', 'order_id', 'customer_id_2', 'total', 'status_2']);
  });

  it('unique values drop repeated rows, sorted on a shown, renamed field', async () => {
    const p = { ...shop('inner', [[0, 'name', { alias: 'Customer', sort: 'desc' }]]) };
    const distinct = { ...p, nodes: p.nodes.map((n) => (n.type === 'query' ? { ...n, querySpec: { ...n.querySpec, distinct: true } } : n)) };
    expect((await run(distinct)).rows).toEqual([['Grace'], ['Barbara L'], ['Barbara'], ['Ada']]);
  });
});

describe('query in the flow', () => {
  const states = () => Object.fromEntries(Object.entries(useFlowStore.getState().nodes).map(([id, e]) => [id, e.status.state]));

  it('is unwired with no tables, broken with an empty grid, and ok once a field is in it', async () => {
    const p = shop('inner', []);
    await evaluateFlow(engine, removeQueryTable(removeQueryTable(p, 'q', 1), 'q', 0));
    expect(states()).toMatchObject({ q: 'unwired', out: 'unwired' });
    await evaluateFlow(engine, p);
    expect(useFlowStore.getState().nodes.q!.status).toEqual({ state: 'error', message: 'Drag fields from the tables into the grid, or double-click them.' });
    await evaluateFlow(engine, addQueryField(p, 'q', { port: 0, column: 'name' }));
    expect(states()).toMatchObject({ q: 'ok', out: 'ok' });
  });

  it('a join line between a number and text is explained before anything runs, on the wire it’s about', async () => {
    let p = shop();
    p = addQueryJoin(p, 'q', { port: 0, column: 'customer_id' }, { port: 1, column: 'status' }, 'j2');
    await evaluateFlow(engine, p);
    expect(useFlowStore.getState().nodes.q!.status).toEqual({
      state: 'error',
      message: 'customer_id in c is a number and status in o is text; change one with Change type.',
      ports: [1],
    });
  });
});
