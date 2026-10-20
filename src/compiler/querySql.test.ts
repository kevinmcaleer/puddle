import type { ColumnSchema, QueryField, QueryJoin, QuerySpec } from '../model';
import { compileQuery, type QueryTable } from './query';
import { compileQuerySql, designSql, querySqlNames, querySqlProblem, readQuerySql, sqlName } from './querySql';

const CUSTOMERS: ColumnSchema[] = [
  { name: 'customer_id', type: 'BIGINT' },
  { name: 'name', type: 'VARCHAR' },
  { name: 'status', type: 'VARCHAR' },
];
const ORDERS: ColumnSchema[] = [
  { name: 'order_id', type: 'BIGINT' },
  { name: 'customer_id', type: 'BIGINT' },
  { name: 'total', type: 'DOUBLE' },
  { name: 'status', type: 'VARCHAR' },
  { name: 'Order Date', type: 'DATE' },
];
const ITEMS: ColumnSchema[] = [
  { name: 'order_id', type: 'BIGINT' },
  { name: 'sku', type: 'VARCHAR' },
];

const TABLES: QueryTable[] = [
  { port: 0, label: 'shop-customers.csv', columns: CUSTOMERS },
  { port: 1, label: 'orders', columns: ORDERS },
  { port: 2, label: 'items', columns: ITEMS },
];
const two = TABLES.slice(0, 2);

const field = (id: string, port: number, column: string, f: Partial<QueryField> = {}): QueryField => ({ id, port, column, show: true, sort: 'none', ...f });
const line = (id: string, l: [number, string], r: [number, string], kind: QueryJoin['kind'] = 'inner'): QueryJoin => ({ id, left: { port: l[0], column: l[1] }, right: { port: r[0], column: r[1] }, kind });
const spec = (s: Partial<QuerySpec>): QuerySpec => ({ tables: [], joins: [], fields: [], distinct: false, totals: false, orRows: 0, ...s });

let n = 0;
const ids = { field: () => `nf${++n}`, join: () => `nj${++n}` };
beforeEach(() => (n = 0));

/** The SQL a design runs, for telling whether two designs are the same query. */
const runs = (s: QuerySpec, tables = two) => compileQuery(s, tables.map((t) => ({ ...t, cte: `"in${t.port + 1}"` })));

const read = (sql: string, tables = two, current = spec({})) => readQuerySql(sql, tables, current, ids);
const spec_ = (sql: string, tables = two, current = spec({})) => {
  const r = read(sql, tables, current);
  if ('reason' in r) throw new Error(r.reason);
  return r.spec;
};
const reason = (sql: string, tables = two) => {
  const r = read(sql, tables);
  return 'reason' in r ? r.reason : undefined;
};

const shop = spec({
  joins: [line('j1', [0, 'customer_id'], [1, 'customer_id'])],
  fields: [field('f1', 1, 'order_id', { sort: 'asc' }), field('f2', 0, 'name'), field('f3', 1, 'total'), field('f4', 1, 'status', { criteria: { op: '=', value: 'shipped' } })],
});

describe('the design as SQL', () => {
  it('writes a clause to a line, a join to a line, tables by their node names and names bare where they can be', () => {
    expect(designSql(shop, two)).toBe(
      [
        'SELECT orders.order_id, "shop-customers.csv".name, orders.total, orders.status',
        'FROM "shop-customers.csv"',
        '  INNER JOIN orders ON "shop-customers.csv".customer_id = orders.customer_id',
        "WHERE orders.status = 'shipped'",
        'ORDER BY orders.order_id ASC',
      ].join('\n'),
    );
  });

  // Regression: tables on inputs 2 and 3 were written as t2 and t3, and a design read back from SQL kept the letters.
  it('qualifies by table name whatever inputs the tables are on, and stays the same through SQL and back', () => {
    const tables: QueryTable[] = [
      { port: 1, label: 'customers.csv', columns: [{ name: 'customer_id', type: 'BIGINT' }, { name: 'country', type: 'VARCHAR' }] },
      { port: 2, label: 'orders.csv', columns: [{ name: 'order_id', type: 'BIGINT' }, { name: 'customer_id', type: 'BIGINT' }] },
    ];
    const sql = [
      'SELECT "customers.csv".country, count("orders.csv".order_id) AS orders',
      'FROM "customers.csv"',
      '  INNER JOIN "orders.csv" ON "customers.csv".customer_id = "orders.csv".customer_id',
      'GROUP BY "customers.csv".country',
      'ORDER BY count("orders.csv".order_id) DESC',
    ].join('\n');
    const s = spec_(sql.replace(/"customers\.csv"\./g, 'c.').replace('FROM "customers.csv"', 'FROM "customers.csv" c'), tables);
    expect(designSql(s, tables)).toBe(sql);
    expect(designSql(spec_(designSql(s, tables), tables, s), tables)).toBe(sql);
  });

  it('writes an expression’s tables by name too, and leaves names that only look like t1 alone', () => {
    const s = spec({
      totals: true,
      fields: [
        field('f1', 1, 'status', { total: 'group', alias: 't1' }),
        field('f2', 1, 'total', { total: 'expression', expression: "sum(t2.total) / count(t1.name) || 't1.x'", alias: 'per' }),
      ],
    });
    expect(designSql(s, two).split('\n')[0]).toBe(`SELECT orders.status AS t1, (sum(orders.total) / count("shop-customers.csv".name) || 't1.x') AS per`);
    expect(spec_(designSql(s, two), two, s).fields[1]!.expression).toBe("sum(t2.total) / count(t1.name) || 't1.x'");
  });

  it('quotes keywords and names with spaces, and nothing else', () => {
    expect(['total', 'Total', 'order', 'Order Date', 'group', 'my_col', '1st', 'a"b'].map(sqlName)).toEqual(['total', 'Total', '"order"', '"Order Date"', '"group"', 'my_col', '"1st"', '"a""b"']);
  });

  it('reads a table as input1 or by its node name, and not by a name two tables share or one that looks like another input', () => {
    const names = querySqlNames([
      { port: 0, label: 'orders' },
      { port: 1, label: 'orders' },
      { port: 2, label: 'input1' },
      { port: 3, label: 'customers' },
    ]);
    expect([...names.values()]).toEqual([['input1'], ['input2'], ['input3'], ['input4', 'customers']]);
    expect(querySqlNames([{ port: 0, label: 'orders' }]).get(0)).toEqual(['input1', 'input', 'orders']);
  });

  it('runs kept SQL over the tables by every name they may be read by, and refuses anything else', () => {
    expect(compileQuerySql('SELECT * FROM orders -- all of them', [{ port: 0, label: 'orders', cte: '"n_o"' }])).toBe(
      'WITH "input1" AS (SELECT * FROM "n_o"), "input" AS (SELECT * FROM "n_o"), "orders" AS (SELECT * FROM "n_o")\nSELECT * FROM (\nSELECT * FROM orders\n)',
    );
    expect(querySqlProblem('SELECT * FROM read_csv(\'x.csv\')', two)).toMatch(/isn’t allowed/);
    expect(querySqlProblem('SELECT * FROM elsewhere', two)).toMatch(/there’s no table elsewhere/);
  });
});

describe('round trip: design to SQL and back', () => {
  const designs: Array<[string, QuerySpec, QueryTable[]?]> = [
    ['a join, sorting, criteria', shop],
    ['every join kind, seen from either end', spec({ joins: [line('j1', [1, 'customer_id'], [0, 'customer_id'], 'left')], fields: [field('f1', 0, 'name'), field('f2', 1, 'total', { sort: 'desc' })] })],
    ['a full join', spec({ joins: [line('j1', [0, 'customer_id'], [1, 'customer_id'], 'full')], fields: [field('f1', 0, '*'), field('f2', 1, 'total')] })],
    ['no join line: every row with every row', spec({ fields: [field('f1', 0, 'name'), field('f2', 1, 'order_id')] })],
    ['renames, hidden fields and unique values', spec({ distinct: true, joins: [line('j1', [0, 'customer_id'], [1, 'customer_id'])], fields: [field('f1', 0, 'name', { alias: 'Customer' }), field('f2', 1, 'status', { show: false, criteria: { op: '<>', value: 'cancelled' } })] })],
    [
      'every kind of criterion, and or rows',
      spec({
        orRows: 2,
        joins: [line('j1', [0, 'customer_id'], [1, 'customer_id'])],
        fields: [
          field('f1', 0, 'name', { criteria: { op: 'contains', value: 'Ada' }, or: [{ op: 'starts', value: 'b' }, { op: 'ends', value: 'z' }] }),
          field('f2', 1, 'total', { criteria: { op: '>=', value: '10' }, or: [null, { op: '<', value: '-2.5' }] }),
          field('f3', 0, 'status', { criteria: { op: 'empty', value: '' }, or: [{ op: 'notEmpty', value: '' }] }),
          field('f4', 1, 'Order Date', { show: false, criteria: { op: '>', value: '2026-01-01' } }),
        ],
      }),
    ],
    [
      'totals: group by, every summary, an expression, criteria on groups and Where fields',
      spec({
        totals: true,
        joins: [line('j1', [0, 'customer_id'], [1, 'customer_id'])],
        fields: [
          field('f1', 0, 'name', { total: 'group', sort: 'asc' }),
          field('f2', 1, 'total', { total: 'sum', criteria: { op: '>', value: '5' } }),
          field('f3', 1, 'total', { total: 'avg', alias: 'Average' }),
          field('f4', 1, 'order_id', { total: 'count' }),
          field('f5', 1, 'status', { total: 'countDistinct' }),
          field('f6', 1, 'total', { total: 'min' }),
          field('f7', 1, 'total', { total: 'max', sort: 'desc' }),
          field('f8', 1, 'total', { total: 'first' }),
          field('f9', 1, 'total', { total: 'last' }),
          field('f10', 1, 'total', { total: 'stdev' }),
          field('f11', 1, 'total', { total: 'var' }),
          field('f12', 1, 'total', { total: 'expression', expression: 'sum(total) / count(order_id)', alias: 'Per order' }),
          field('f13', 1, 'status', { total: 'where', show: false, criteria: { op: '=', value: 'shipped' } }),
          field('f14', 0, 'status', { total: 'group', show: false }),
        ],
      }),
    ],
    [
      'totals with or rows on the groups',
      spec({
        totals: true,
        orRows: 1,
        joins: [line('j1', [0, 'customer_id'], [1, 'customer_id'])],
        fields: [field('f1', 0, 'name', { total: 'group' }), field('f2', 1, 'total', { total: 'sum', criteria: { op: '>', value: '20' }, or: [{ op: '<', value: '5' }] }), field('f3', 1, 'status', { total: 'where', show: false, criteria: { op: '=', value: 'shipped' }, or: [{ op: '=', value: 'shipped' }] })],
      }),
    ],
    [
      'three tables, joined in input order',
      spec({ joins: [line('j1', [0, 'customer_id'], [1, 'customer_id'], 'left'), line('j2', [1, 'order_id'], [2, 'order_id'], 'left')], fields: [field('f1', 0, 'name'), field('f2', 2, 'sku', { sort: 'asc' })] }),
      TABLES,
    ],
    ['a whole table and a field of another', spec({ joins: [line('j1', [0, 'customer_id'], [1, 'customer_id'])], fields: [field('f1', 1, '*'), field('f2', 0, 'name', { alias: 'customer' })] })],
  ];

  it.each(designs)('%s', (_, design, tables = two) => {
    const sql = designSql(design, tables);
    const back = spec_(sql, tables, design);
    expect(runs(back, tables)).toBe(runs(design, tables));
    // And the SQL view shows the same SQL again.
    expect(designSql(back, tables)).toBe(sql);
  });

  it('keeps the ids of fields and lines that are still there', () => {
    const back = spec_(designSql(shop, two), two, shop);
    expect(back.fields.map((f) => f.id)).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(back.joins.map((j) => j.id)).toEqual(['j1']);
  });
});

describe('hand-written SQL into the design', () => {
  it('unqualified names, input names, joins written either way round, and a sort by a new name', () => {
    const s = spec_(`select order_id, name as who, total from input2 o left join input1 c on c.customer_id = o.customer_id where total > 10 and name ilike '%ad%' order by who desc;`);
    expect(s.fields).toEqual([
      field('nf1', 1, 'order_id'),
      field('nf2', 0, 'name', { alias: 'who', sort: 'desc', criteria: { op: 'contains', value: 'ad' } }),
      field('nf3', 1, 'total', { criteria: { op: '>', value: '10' } }),
    ]);
    // orders keeps every row: the line runs customers to orders, so that's every row of its right end.
    expect(s.joins).toEqual([line('nj4', [0, 'customer_id'], [1, 'customer_id'], 'right')]);
    expect(runs(s)).toContain('FROM "in1" AS "t1" RIGHT JOIN "in2" AS "t2"');
  });

  it('a condition on a field the SELECT leaves out goes on a hidden field, as in Access', () => {
    const s = spec_(`SELECT name FROM "shop-customers.csv", orders WHERE status = 'x' OR orders.total < 3`.replace('status', '"shop-customers.csv".status'));
    expect(s.fields).toEqual([field('nf1', 0, 'name'), field('nf2', 0, 'status', { show: false, criteria: { op: '=', value: 'x' } }), field('nf3', 1, 'total', { show: false, or: [{ op: '<', value: '3' }] })]);
    expect(s.orRows).toBe(1);
  });

  it('two conditions on one field in a row go on two fields; a literal first turns the comparison round', () => {
    const s = spec_('SELECT total FROM orders, "shop-customers.csv" WHERE 5 < total AND total <= 9');
    expect(s.fields).toEqual([field('nf1', 1, 'total', { criteria: { op: '>', value: '5' } }), field('nf2', 1, 'total', { show: false, criteria: { op: '<=', value: '9' } })]);
  });

  it('GROUP BY and summaries turn on Totals; count(*) is an expression; a HAVING with OR is or rows, its WHERE in each', () => {
    const s = spec_(`SELECT orders.status, count(*) AS n, sum(total) FROM orders CROSS JOIN "shop-customers.csv" WHERE customer_id > 0 GROUP BY orders.status HAVING sum(total) > 10 OR sum(total) < 1`.replace('customer_id > 0', 'orders.customer_id > 0'));
    expect(s.totals).toBe(true);
    expect(s.orRows).toBe(1);
    expect(s.fields).toEqual([
      field('nf1', 1, 'status', { total: 'group' }),
      field('nf2', 1, 'order_id', { total: 'expression', expression: 'count(*)', alias: 'n' }),
      field('nf3', 1, 'total', { total: 'sum', criteria: { op: '>', value: '10' }, or: [{ op: '<', value: '1' }] }),
      field('nf4', 1, 'customer_id', { total: 'where', show: false, criteria: { op: '>', value: '0' }, or: [{ op: '>', value: '0' }] }),
    ]);
  });

  it('a sort the grid order can’t give goes on a hidden field at the end; ORDER BY a number is that field', () => {
    const s = spec_('SELECT name, total FROM orders, "shop-customers.csv" ORDER BY total, name DESC');
    expect(s.fields.map((f) => [f.column, f.show, f.sort])).toEqual([['name', true, 'none'], ['total', true, 'asc'], ['name', false, 'desc']]);
    expect(spec_('SELECT name, total FROM orders, "shop-customers.csv" ORDER BY 2 DESC').fields[1]!.sort).toBe('desc');
  });

  it('an expression reads its tables as the design does, t1 for input 1, and criteria on it find it', () => {
    const s = spec_('SELECT o.status, sum(o.total) / count(*) AS per FROM orders o, "shop-customers.csv" c GROUP BY o.status HAVING sum(o.total) / count(*) > 2');
    expect(s.fields[1]).toEqual(field('nf2', 1, 'total', { total: 'expression', expression: 'sum(t2.total) / count(*)', alias: 'per', criteria: { op: '>', value: '2' } }));
    expect(reason('SELECT o.status, (SELECT 1) + sum(o.total) AS x FROM orders o, "shop-customers.csv" c GROUP BY o.status')).toMatch(/subquery has no place/);
  });

  it('GROUP BY ALL groups every plain field', () => {
    const s = spec_('SELECT status, max(total) FROM orders o, "shop-customers.csv" c GROUP BY ALL'.replace('SELECT status', 'SELECT o.status'));
    expect(s.fields.map((f) => f.total)).toEqual(['group', 'max']);
  });
});

describe('SQL the grid can’t show', () => {
  it.each([
    ['LIMIT', 'SELECT name FROM orders, "shop-customers.csv" LIMIT 5', /LIMIT has no place/],
    ['UNION', 'SELECT name FROM "shop-customers.csv", orders UNION SELECT name FROM "shop-customers.csv", orders', /UNION has no place/],
    ['a CTE', 'WITH x AS (SELECT 1) SELECT * FROM orders, "shop-customers.csv"', /WITH has no place/],
    ['a calculation without totals', 'SELECT total * 2 AS double FROM orders, "shop-customers.csv"', /total \* 2 is a calculation/],
    ['a table left out', 'SELECT * FROM orders', /leaves out shop-customers.csv/],
    ['a name in two tables', 'SELECT customer_id FROM orders, "shop-customers.csv"', /customer_id is in orders and shop-customers.csv: say which, as orders.customer_id/],
    ['a column that isn’t there', 'SELECT nope FROM orders, "shop-customers.csv"', /nope isn’t a column/],
    ['a join on something other than equal fields', 'SELECT name FROM orders JOIN "shop-customers.csv" c ON c.customer_id > orders.customer_id', /isn’t one field equal to another/],
    ['OR inside a row', `SELECT name FROM orders, "shop-customers.csv" WHERE total > 1 AND (name = 'a' OR status = 'b')`, /puts OR inside a row/],
    ['IN', `SELECT name FROM orders, "shop-customers.csv" WHERE name IN ('a')`, /IN has no place/],
    ['a plain field not grouped', 'SELECT name, sum(total) FROM orders, "shop-customers.csv"', /name is neither grouped nor summarised/],
    ['a case-sensitive contains', `SELECT name FROM orders, "shop-customers.csv" WHERE contains(name, 'Ada')`, /isn’t a condition the grid’s criteria can show/],
    ['SQL that can’t run at all', 'SELECT * FROM somewhere_else', /there’s no table somewhere_else/],
  ])('%s', (_, sql, why) => {
    expect(reason(sql)).toMatch(why);
  });

  it('outer joins among three tables written in an order the designer doesn’t join them in', () => {
    expect(reason('SELECT sku FROM items LEFT JOIN orders ON orders.order_id = items.order_id INNER JOIN "shop-customers.csv" c ON c.customer_id = orders.customer_id', TABLES)).toMatch(/outer joins are written in another order/);
    // Inner joins can be written in any order.
    expect(reason('SELECT sku FROM items JOIN orders ON orders.order_id = items.order_id JOIN "shop-customers.csv" c ON c.customer_id = orders.customer_id', TABLES)).toBeUndefined();
  });
});
