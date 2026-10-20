// Query nodes on real DuckDB-WASM (Node build): shop customers and orders joined by the lines the designer draws,
// with the grid's fields, aliases, criteria (and or rows), sorting and unique values, the Totals row grouping and
// summarising, and the SQL view: its SQL run as written, and SQL read back into the design.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileDisplayPage, designSql, readQuerySql, sourceFileName, type QueryTable } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { evaluateFlow, invalidateCaches, schemaCacheFor, useFlowStore } from '../../src/flow/status';
import { addQueryField, addQueryJoin, addQueryOrRow, addQueryTable, removeQueryOrRow, removeQueryTable, setQueryCriteria, setQueryDesign, setQueryJoinKind, setQuerySpec, setQuerySql, updateQueryField, type Project, type QueryField, type QueryJoinKind } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

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

/** The shop query with its Totals row on. */
const withTotals = (p: Project, totals = true) => setQuerySpec(p, 'q', { totals });

describe('query totals', () => {
  it('grouping orders by customer with Sum of total and Count of orders matches the Group by node', async () => {
    // Orders alone, in a Query and in a Group by (a pivot with no Columns field), side by side.
    let p = flow({
      sources: [orders],
      nodes: [
        { id: 'o', type: 'source', sourceId: 'orders' },
        { id: 'q', type: 'query' },
        { id: 'g', type: 'transform', steps: [step('s', 'pivot', { rows: ['customer_id'], values: [{ column: 'total', agg: 'sum' }, { column: 'order_id', agg: 'count' }] })] },
      ],
      wires: [['o', 'g']],
    });
    p = addQueryTable(p, 'q', 'o');
    p = addQueryField(p, 'q', { port: 0, column: 'customer_id' }, undefined, 'f1');
    p = addQueryField(p, 'q', { port: 0, column: 'total' }, undefined, 'f2');
    p = addQueryField(p, 'q', { port: 0, column: 'order_id' }, undefined, 'f3');
    p = updateQueryField(p, 'q', 'f1', { sort: 'asc' });
    p = updateQueryField(p, 'q', 'f2', { total: 'sum' });
    p = updateQueryField(p, 'q', 'f3', { total: 'count' });
    p = withTotals(p);
    const [query, group] = [await run(p, 'q'), await run(p, 'g')];
    expect(query.columns).toEqual(['customer_id', 'SumOftotal', 'CountOforder_id']);
    expect(group.columns).toEqual(['customer_id', 'sum of total', 'count of order_id']);
    expect(query.rows).toEqual(group.rows);
    expect(query.types).toEqual(group.types);
    expect(query.rows).toEqual([
      ['1', '15.75', '2'],
      ['2', '8.0', '1'],
      ['4', '9.99', '1'],
      ['5', '1.0', '1'],
    ]);
  });

  it('criteria on a summary filter the groups, not the rows', async () => {
    // Ada's orders are 12.50 and 3.25: as rows only one is over 10, as a group her total is.
    const fields: Array<[number, string, Partial<QueryField>?]> = [[0, 'name', { sort: 'asc' }], [1, 'total', { total: 'sum', criteria: { op: '>', value: '10' } }]];
    expect((await run(withTotals(shop('inner', fields)))).rows).toEqual([['Ada', '15.75']]);
    // Grace's 8.00 alone isn't, so a row filter keeps a different answer: Ada's one big order.
    expect((await run(shop('inner', fields))).rows).toEqual([['Ada', '12.5']]);
  });

  it('Where fields filter rows before grouping and don’t show', async () => {
    const p = withTotals(
      shop('inner', [
        [0, 'name', { sort: 'asc' }],
        [1, 'order_id', { total: 'count' }],
        [1, 'status', { total: 'where', show: false, criteria: { op: '=', value: 'shipped' } }],
      ]),
    );
    const { columns, rows } = await run(p);
    expect(columns).toEqual(['name', 'CountOforder_id']);
    expect(rows).toEqual([['Ada', '2']]);
  });

  it('every summary, an expression and a rename, sorted on a summary', async () => {
    const p = withTotals(
      shop('inner', [
        [1, 'status'],
        [1, 'total', { total: 'avg', alias: 'Average total' }],
        [1, 'total', { total: 'min' }],
        [1, 'total', { total: 'max', sort: 'desc' }],
        [0, 'name', { total: 'countDistinct' }],
        [1, 'total', { total: 'expression', expression: 'round(sum(total) / count(*), 3)' }],
        [1, 'total', { total: 'stdev' }],
        [1, 'total', { total: 'var' }],
      ]),
    );
    const { columns, rows } = await run(p);
    expect(columns).toEqual(['status', 'Average total', 'MinOftotal', 'MaxOftotal', 'CountDistinctOfname', 'Expr1', 'StDevOftotal', 'VarOftotal']);
    expect(rows.map((r) => r.slice(0, 6))).toEqual([
      ['shipped', '7.875', '3.25', '12.5', '1', '7.875'],
      ['pending', '3.3333333333333335', '1.0', '8.0', '3', '3.333'],
    ]);
    expect(Number(rows[1]![7])).toBeCloseTo(16.333, 3);
  });

  it('turning Totals off brings back the rows as they were', async () => {
    const fields: Array<[number, string, Partial<QueryField>?]> = [[1, 'order_id', { sort: 'asc' }], [1, 'total', { total: 'sum' }]];
    const before = await run(shop('inner', fields));
    expect(before.rows).toHaveLength(5);
    expect(await run(withTotals(withTotals(shop('inner', fields)), false))).toEqual(before);
  });

  it('an expression on a column that isn’t grouped is explained in plain words', async () => {
    const p = withTotals(shop('inner', [[1, 'customer_id'], [1, 'total', { total: 'expression', expression: 'order_id' }]]));
    await expect(run(p)).rejects.toThrow('order_id is used but neither grouped nor summarised. Set its Total to Group by');
  });

  it('a sum of text is explained before anything runs', async () => {
    await evaluateFlow(engine, withTotals(shop('inner', [[0, 'name', { total: 'sum' }]])));
    expect(useFlowStore.getState().nodes.q!.status).toMatchObject({ state: 'error', message: 'Sum needs numbers, and name is text. Pick Count, Min or Max for it, or change its type with Change type.' });
  });
});

describe('query or rows', () => {
  // Every customer, with their orders where they have them, named once each.
  const customers = (fields: Array<[number, string, Partial<QueryField>?]>) => setQuerySpec(shop('left', [[0, 'name', { sort: 'asc' }], ...fields]), 'q', { distinct: true });
  const names = async (p: Project) => (await run(p)).rows.map((r) => r[0]);

  it('lapsed customers or customers with an order over 10 give the union of both', async () => {
    const lapsed = customers([[0, 'status', { show: false, criteria: { op: '=', value: 'lapsed' } }]]);
    const big = customers([[1, 'total', { show: false, criteria: { op: '>', value: '10' } }]]);
    expect(await names(lapsed)).toEqual(['Barbara L', 'Edsger']);
    expect(await names(big)).toEqual(['Ada']);
    // The same two conditions on two rows of one grid.
    let either = addQueryOrRow(customers([[0, 'status', { show: false }], [1, 'total', { show: false }]]), 'q');
    either = setQueryCriteria(either, 'q', 'f1', 0, { op: '=', value: 'lapsed' });
    either = setQueryCriteria(either, 'q', 'f2', 1, { op: '>', value: '10' });
    expect(await names(either)).toEqual(['Ada', 'Barbara L', 'Edsger']);
    // On one row they're ANDed: no lapsed customer has an order over 10.
    const both = setQueryCriteria(customers([[0, 'status', { show: false, criteria: { op: '=', value: 'lapsed' } }], [1, 'total', { show: false }]]), 'q', 'f2', 0, { op: '>', value: '10' });
    expect(await names(both)).toEqual([]);
    // Removing the or row leaves the first condition alone.
    expect(await names(removeQueryOrRow(either, 'q', 1))).toEqual(['Barbara L', 'Edsger']);
  });

  it('with Totals, or rows on a summary filter the groups', async () => {
    let p = withTotals(shop('inner', [[0, 'name', { sort: 'asc' }], [1, 'total', { total: 'sum', criteria: { op: '>', value: '10' } }]]));
    p = setQueryCriteria(addQueryOrRow(p, 'q'), 'q', 'f1', 1, { op: '<', value: '2' });
    expect((await run(p)).rows).toEqual([
      ['Ada', '15.75'],
      ['Barbara', '1.0'],
      ['Barbara L', '1.0'],
    ]);
  });

  it('with Totals, or rows on a Where field filter the rows before grouping', async () => {
    let p = withTotals(shop('inner', [[0, 'name', { sort: 'asc' }], [1, 'order_id', { total: 'count' }], [1, 'total', { total: 'where', show: false, criteria: { op: '>', value: '10' } }]]));
    p = setQueryCriteria(addQueryOrRow(p, 'q'), 'q', 'f2', 1, { op: '<', value: '2' });
    expect((await run(p)).rows).toEqual([
      ['Ada', '1'],
      ['Barbara', '1'],
      ['Barbara L', '1'],
    ]);
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

describe('query SQL view', () => {
  /** The Query's tables with their columns, as the SQL view reads them. */
  async function sqlTables(p: Project): Promise<QueryTable[]> {
    const cache = schemaCacheFor(engine);
    return [{ port: 0, label: 'c', columns: await cache.get(p, { nodeId: 'c' }) }, { port: 1, label: 'o', columns: await cache.get(p, { nodeId: 'o' }) }];
  }
  const spec = (p: Project) => (p.nodes.find((n) => n.id === 'q') as Extract<Project['nodes'][number], { type: 'query' }>).querySpec;

  it('the SQL it shows runs as written to the same rows as the design, totals and or rows included', async () => {
    const designs = [
      shop('left', [[1, 'order_id', { sort: 'desc' }], [0, 'name', { alias: 'Customer name', criteria: { op: 'contains', value: 'a' } }], [0, 'status', { show: false, criteria: { op: 'notEmpty', value: '' }, or: [{ op: 'empty', value: '' }] }]]),
      withTotals(shop('inner', [[0, 'name', { sort: 'asc' }], [1, 'total', { total: 'sum', criteria: { op: '>', value: '5' } }], [1, 'total', { total: 'expression', expression: 'round(sum(total) / count(*), 3)' }], [1, 'status', { total: 'where', show: false, criteria: { op: '=', value: 'shipped' } }]])),
    ];
    designs[0] = addQueryOrRow(designs[0]!, 'q');
    for (const p of designs) {
      const sql = designSql(spec(p), await sqlTables(p));
      const [design, written] = [await run(p), await run(setQuerySql(p, 'q', sql))];
      expect(written).toEqual(design);
      expect(design.rows.length).toBeGreaterThan(0);
    }
  });

  it('hand-written SQL read into the design gives the rows the SQL does', async () => {
    const p = shop('inner', []);
    const sql = `SELECT name AS who, sum(total) AS spent, count(*) AS orders, sum(x.total) * 2 AS doubled
FROM o AS x JOIN c ON c.customer_id = x.customer_id
WHERE x.status ILIKE 'ship%'
GROUP BY name
HAVING sum(total) > 1
ORDER BY spent DESC`;
    const reading = readQuerySql(sql, await sqlTables(p), spec(p));
    if ('reason' in reading) throw new Error(reading.reason);
    const [design, written] = [await run(setQueryDesign(p, 'q', reading.spec)), await run(setQuerySql(p, 'q', sql))];
    expect(design.columns).toEqual(['who', 'spent', 'orders', 'doubled']);
    expect(design).toEqual(written);
    expect(design.rows).toEqual([['Ada', '15.75', '2', '31.5']]);
  });

  it('Top values keeps the first rows of the sorted result, and LIMIT read back from SQL does the same', async () => {
    const p = shop('inner', [[1, 'order_id'], [1, 'total', { sort: 'desc' }]]);
    const top = setQuerySpec(p, 'q', { limit: 2 });
    expect((await run(top)).rows).toEqual([['100', '12.5'], ['101', '8.0']]);
    const sql = designSql(spec(top), await sqlTables(top));
    expect(sql).toMatch(/\nLIMIT 2$/);
    const reading = readQuerySql(sql.replace('LIMIT 2', 'limit 3'), await sqlTables(top), spec(top));
    if ('reason' in reading) throw new Error(reading.reason);
    expect((await run(setQueryDesign(p, 'q', reading.spec))).rows).toHaveLength(3);
  });

  it('SQL the grid can’t show runs as written, and discarding it brings back the design', async () => {
    const p = shop();
    const kept = setQuerySql(p, 'q', 'SELECT order_id, total FROM o ORDER BY total DESC LIMIT 2');
    expect((await run(kept)).rows).toEqual([['100', '12.5'], ['103', '9.99']]);
    expect(await run(setQuerySql(kept, 'q', undefined))).toEqual(await run(p));
    await evaluateFlow(engine, setQuerySql(p, 'q', 'SELECT * FROM somewhere'));
    expect(useFlowStore.getState().nodes.q!.status).toMatchObject({ state: 'error', message: expect.stringContaining('This query can’t run: there’s no table somewhere') });
  });
});
