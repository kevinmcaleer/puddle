import { flow, src } from '../../tests/helpers/projects';
import type { ColumnSchema, QueryField, QueryJoin, QuerySpec } from '../model';
import { compile, upstreamKey } from './compile';
import { CompileError, PendingSchemaError, UnwiredError } from './errors';
import { compileQuery, criteriaPlace, crossJoinedTables, defaultNames, joinPlan, queryColumns, queryProblems, type QueryTable } from './query';
import { SchemaBook } from './schemaBook';

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
];

const tables = (...cols: ColumnSchema[][]): Array<QueryTable & { cte: string }> => cols.map((columns, port) => ({ port, label: ['customers', 'orders', 'items'][port]!, columns, cte: `"in${port + 1}"` }));
const field = (id: string, port: number, column: string, f: Partial<QueryField> = {}): QueryField => ({ id, port, column, show: true, sort: 'none', ...f });
const line = (id: string, l: [number, string], r: [number, string], kind: QueryJoin['kind'] = 'inner'): QueryJoin => ({ id, left: { port: l[0], column: l[1] }, right: { port: r[0], column: r[1] }, kind });
const spec = (s: Partial<QuerySpec>): QuerySpec => ({ tables: [], joins: [], fields: [], distinct: false, totals: false, ...s });

const shop = spec({
  joins: [line('j1', [0, 'customer_id'], [1, 'customer_id'])],
  fields: [field('f1', 0, 'name'), field('f2', 1, 'order_id'), field('f3', 1, 'total', { sort: 'desc' })],
});

describe('query SQL', () => {
  it('joins the tables on their lines and selects the grid’s fields in order', () => {
    expect(compileQuery(shop, tables(CUSTOMERS, ORDERS))).toBe(
      'SELECT "t1"."name", "t2"."order_id", "t2"."total" FROM "in1" AS "t1" INNER JOIN "in2" AS "t2" ON "t1"."customer_id" = "t2"."customer_id" ORDER BY "t2"."total" DESC',
    );
  });

  it.each([
    ['inner', 'INNER'],
    ['left', 'LEFT'],
    ['right', 'RIGHT'],
    ['full', 'FULL'],
  ] as const)('a %s line from the first table is a %s JOIN', (kind, sql) => {
    const s = spec({ ...shop, joins: [line('j1', [0, 'customer_id'], [1, 'customer_id'], kind)] });
    expect(compileQuery(s, tables(CUSTOMERS, ORDERS))).toContain(`${sql} JOIN "in2"`);
  });

  it('turns a line drawn from the later table round: every row of orders is a RIGHT JOIN after customers', () => {
    const s = spec({ ...shop, joins: [line('j1', [1, 'customer_id'], [0, 'customer_id'], 'left')] });
    expect(compileQuery(s, tables(CUSTOMERS, ORDERS))).toContain('RIGHT JOIN "in2" AS "t2" ON "t2"."customer_id" = "t1"."customer_id"');
  });

  it('matches on every line between two tables', () => {
    const s = spec({ ...shop, joins: [line('j1', [0, 'customer_id'], [1, 'customer_id']), line('j2', [0, 'status'], [1, 'status'])] });
    expect(compileQuery(s, tables(CUSTOMERS, ORDERS))).toContain('ON "t1"."customer_id" = "t2"."customer_id" AND "t1"."status" = "t2"."status"');
  });

  it('chains three tables through the lines, whatever order they were added in', () => {
    // items (2) joins orders (1), which joins customers (0): customers, then orders, then items.
    const s = spec({ joins: [line('j2', [1, 'order_id'], [2, 'order_id']), line('j1', [0, 'customer_id'], [1, 'customer_id'])], fields: [field('f1', 2, 'sku')] });
    expect(joinPlan(s, [2, 0, 1])).toEqual({ first: 0, steps: [{ port: 1, kind: 'INNER', lines: [s.joins[1]] }, { port: 2, kind: 'INNER', lines: [s.joins[0]] }] });
  });

  it('cross joins a table no line reaches, and says which', () => {
    const s = spec({ fields: [field('f1', 0, 'name'), field('f2', 1, 'total')] });
    expect(compileQuery(s, tables(CUSTOMERS, ORDERS))).toContain('FROM "in1" AS "t1" CROSS JOIN "in2" AS "t2"');
    expect(crossJoinedTables(s, [0, 1])).toEqual([1]);
    expect(crossJoinedTables(shop, [0, 1])).toEqual([]);
  });

  it('opens * out into every column of its table, numbering names already taken', () => {
    const s = spec({ ...shop, fields: [field('f1', 0, '*'), field('f2', 1, '*')] });
    expect(queryColumns(s, tables(CUSTOMERS, ORDERS)).map((c) => c.name)).toEqual(['customer_id', 'name', 'status', 'order_id', 'customer_id_2', 'total', 'status_2']);
    expect(compileQuery(s, tables(CUSTOMERS, ORDERS))).toContain('"t2"."customer_id" AS "customer_id_2"');
  });

  it('renames a field with its alias and leaves hidden fields out (they can still sort and filter)', () => {
    const s = spec({ ...shop, fields: [field('f1', 0, 'name', { alias: 'Customer' }), field('f2', 1, 'total', { show: false, sort: 'asc', criteria: { op: '>=', value: '5' } })] });
    expect(compileQuery(s, tables(CUSTOMERS, ORDERS))).toBe(
      'SELECT "t1"."name" AS "Customer" FROM "in1" AS "t1" INNER JOIN "in2" AS "t2" ON "t1"."customer_id" = "t2"."customer_id" WHERE "t2"."total" >= 5 ORDER BY "t2"."total" ASC',
    );
  });

  it.each([
    [{ op: '=', value: "O'Brien" }, `"t1"."name" = 'O''Brien'`],
    [{ op: '<>', value: '3' }, `"t1"."customer_id" <> 3`],
    [{ op: 'contains', value: 'Ad' }, `contains(lower(CAST("t1"."name" AS VARCHAR)), lower('Ad'))`],
    [{ op: 'starts', value: 'g' }, `starts_with(lower(CAST("t1"."name" AS VARCHAR)), lower('g'))`],
    [{ op: 'ends', value: 'a' }, `suffix(lower(CAST("t1"."name" AS VARCHAR)), lower('a'))`],
    [{ op: 'empty', value: '' }, `("t1"."name" IS NULL OR trim(CAST("t1"."name" AS VARCHAR)) = '')`],
    [{ op: 'notEmpty', value: '' }, `("t1"."name" IS NOT NULL AND trim(CAST("t1"."name" AS VARCHAR)) <> '')`],
  ] as const)('criteria %o read as %s', (criteria, sql) => {
    const column = criteria.op === '<>' ? 'customer_id' : 'name';
    const s = spec({ fields: [field('f1', 0, column, { criteria })] });
    expect(compileQuery(s, tables(CUSTOMERS))).toContain(`WHERE ${sql}`);
  });

  it('adds DISTINCT for unique values', () => {
    expect(compileQuery({ ...shop, distinct: true }, tables(CUSTOMERS, ORDERS))).toMatch(/^SELECT DISTINCT /);
  });
});

describe('query problems', () => {
  const problems = (s: QuerySpec, ...cols: ColumnSchema[][]) => queryProblems(s, tables(...cols)).map((p) => p.message);

  it('none for a ready query', () => expect(problems(shop, CUSTOMERS, ORDERS)).toEqual([]));

  it('asks for fields, and for one that shows', () => {
    expect(problems(spec({}), CUSTOMERS)).toEqual(['Drag fields from the tables into the grid, or double-click them.']);
    expect(problems(spec({ fields: [field('f1', 0, 'name', { show: false })] }), CUSTOMERS)).toEqual(['Show at least one field: tick Show in the grid.']);
  });

  it('names fields and lines on a table or column that has gone', () => {
    const s = spec({ joins: [line('j1', [0, 'customer_id'], [1, 'cust'])], fields: [field('f1', 0, 'nme'), field('f2', 2, 'sku')] });
    expect(queryProblems(s, tables(CUSTOMERS, ORDERS))).toEqual([
      { field: 'f1', port: 0, message: 'nme isn’t in customers any more.' },
      { field: 'f2', message: 'sku comes from input 3, which has no table now. Remove it from the grid.' },
      { join: 'j1', port: 1, message: 'cust isn’t in orders any more. Remove the join line.' },
    ]);
  });

  it('refuses a line between columns that can’t be compared', () => {
    const s = spec({ ...shop, joins: [line('j1', [0, 'customer_id'], [1, 'status'])] });
    expect(problems(s, CUSTOMERS, ORDERS)).toEqual(['customer_id in customers is a number and status in orders is text; change one with Change type.']);
  });

  it('checks criteria values', () => {
    expect(problems(spec({ fields: [field('f1', 0, 'name', { criteria: { op: '=', value: ' ' } })] }), CUSTOMERS)).toEqual(['Give name a value to compare with.']);
    expect(problems(spec({ fields: [field('f1', 0, 'customer_id', { criteria: { op: '>', value: 'ten' } })] }), CUSTOMERS)).toEqual(['customer_id is a number, so compare it with a number, not “ten”.']);
    expect(problems(spec({ fields: [field('f1', 0, 'customer_id', { criteria: { op: 'empty', value: '' } })] }), CUSTOMERS)).toEqual([]);
  });

  it('refuses two fields given the same name (DuckDB ignores case)', () => {
    const s = spec({ ...shop, fields: [field('f1', 0, 'name'), field('f2', 1, 'status', { alias: 'NAME' })] });
    expect(problems(s, CUSTOMERS, ORDERS)).toEqual(['Two fields are called NAME. Give one of them another name.']);
  });

  it('refuses sorting or filtering on *, and sorting unique values on a hidden field', () => {
    expect(problems(spec({ fields: [field('f1', 0, '*', { sort: 'asc' })] }), CUSTOMERS)).toEqual(['Sort and filter on a single field of customers, not *.']);
    expect(problems(spec({ distinct: true, fields: [field('f1', 0, 'name'), field('f2', 0, 'status', { show: false, sort: 'asc' })] }), CUSTOMERS)).toEqual([
      'A hidden field can’t sort unique values. Show it, or turn off Unique values.',
    ]);
  });
});

describe('query totals', () => {
  const orders = (fields: QueryField[], s: Partial<QuerySpec> = {}) => spec({ totals: true, fields, ...s });

  it('groups by customer with a sum and a count, named as Access names them', () => {
    const s = orders([field('f1', 1, 'customer_id', { sort: 'asc' }), field('f2', 1, 'total', { total: 'sum' }), field('f3', 1, 'order_id', { total: 'count' })]);
    expect(compileQuery(s, tables(CUSTOMERS, ORDERS).slice(1))).toBe(
      'SELECT "t2"."customer_id", sum("t2"."total") AS "SumOftotal", count("t2"."order_id") AS "CountOforder_id" FROM "in2" AS "t2" GROUP BY "t2"."customer_id" ORDER BY "t2"."customer_id" ASC',
    );
    expect(queryColumns(s, tables(CUSTOMERS, ORDERS).slice(1)).map((c) => [c.name, c.type])).toEqual([
      ['customer_id', 'BIGINT'],
      ['SumOftotal', 'DOUBLE'],
      ['CountOforder_id', 'BIGINT'],
    ]);
  });

  it.each([
    ['sum', 'sum("t2"."total")', 'SumOftotal'],
    ['avg', 'avg("t2"."total")', 'AvgOftotal'],
    ['min', 'min("t2"."total")', 'MinOftotal'],
    ['max', 'max("t2"."total")', 'MaxOftotal'],
    ['count', 'count("t2"."total")', 'CountOftotal'],
    ['countDistinct', 'count(DISTINCT "t2"."total")', 'CountDistinctOftotal'],
    ['first', 'first("t2"."total")', 'FirstOftotal'],
    ['last', 'last("t2"."total")', 'LastOftotal'],
    ['stdev', 'stddev_samp("t2"."total")', 'StDevOftotal'],
    ['var', 'var_samp("t2"."total")', 'VarOftotal'],
  ] as const)('%s summarises as %s, named %s', (total, sql, name) => {
    const s = orders([field('f1', 1, 'total', { total })]);
    expect(compileQuery(s, tables(CUSTOMERS, ORDERS).slice(1))).toBe(`SELECT ${sql} AS "${name}" FROM "in2" AS "t2"`);
  });

  it('puts Where criteria in WHERE, before grouping, and criteria on grouped and summarised fields in HAVING', () => {
    const s = orders([
      field('f1', 0, 'name', { criteria: { op: 'starts', value: 'B' } }),
      field('f2', 1, 'total', { total: 'sum', criteria: { op: '>', value: '5' }, sort: 'desc' }),
      field('f3', 1, 'status', { total: 'where', show: false, criteria: { op: '=', value: 'shipped' } }),
    ], { joins: shop.joins });
    expect(compileQuery(s, tables(CUSTOMERS, ORDERS))).toBe(
      'SELECT "t1"."name", sum("t2"."total") AS "SumOftotal" FROM "in1" AS "t1" INNER JOIN "in2" AS "t2" ON "t1"."customer_id" = "t2"."customer_id"' +
        ` WHERE "t2"."status" = 'shipped' GROUP BY "t1"."name" HAVING starts_with(lower(CAST("t1"."name" AS VARCHAR)), lower('B')) AND sum("t2"."total") > 5 ORDER BY sum("t2"."total") DESC`,
    );
    expect(s.fields.map((f) => criteriaPlace(s, f))).toEqual(['having', 'having', 'where']);
    expect(s.fields.map((f) => criteriaPlace({ totals: false }, f))).toEqual(['where', 'where', 'where']);
  });

  it('groups by a hidden Group by field too, and compares a count with a number even on a text column', () => {
    const s = orders([field('f1', 1, 'customer_id', { show: false }), field('f2', 1, 'status', { total: 'count', criteria: { op: '>=', value: '2' } })]);
    expect(compileQuery(s, tables(CUSTOMERS, ORDERS).slice(1))).toBe('SELECT count("t2"."status") AS "CountOfstatus" FROM "in2" AS "t2" GROUP BY "t2"."customer_id" HAVING count("t2"."status") >= 2');
  });

  it('an Expression field is its expression, named Expr1, Expr2 in grid order, and can be filtered and sorted', () => {
    const s = orders([
      field('f1', 1, 'customer_id'),
      field('f2', 1, 'total', { total: 'expression', expression: 'sum(total) * 2', criteria: { op: '<', value: '10' }, sort: 'asc' }),
      field('f3', 1, 'order_id', { total: 'expression', expression: 'max(order_id) - min(order_id)', alias: 'Spread' }),
    ]);
    expect(defaultNames(s).get('f2')).toBe('Expr1');
    expect(defaultNames(s).get('f3')).toBe('Expr2');
    expect(compileQuery(s, tables(CUSTOMERS, ORDERS).slice(1))).toBe(
      'SELECT "t2"."customer_id", (sum(total) * 2) AS "Expr1", (max(order_id) - min(order_id)) AS "Spread" FROM "in2" AS "t2" GROUP BY "t2"."customer_id" HAVING (sum(total) * 2) < 10 ORDER BY (sum(total) * 2) ASC',
    );
  });

  it('turning Totals off keeps each field’s Total but compiles the grid as it was', () => {
    const fields = [field('f1', 1, 'customer_id'), field('f2', 1, 'total', { total: 'sum', criteria: { op: '>', value: '5' } })];
    const before = compileQuery(spec({ fields }), tables(CUSTOMERS, ORDERS).slice(1));
    expect(before).toBe('SELECT "t2"."customer_id", "t2"."total" FROM "in2" AS "t2" WHERE "t2"."total" > 5');
    expect(compileQuery(orders(fields, { totals: false }), tables(CUSTOMERS, ORDERS).slice(1))).toBe(before);
  });

  describe('problems', () => {
    const problems = (s: QuerySpec) => queryProblems(s, tables(CUSTOMERS, ORDERS)).map((p) => p.message);

    it('none for a grouped query', () => expect(problems(orders([field('f1', 1, 'customer_id'), field('f2', 1, 'total', { total: 'sum' })], { joins: shop.joins }))).toEqual([]));

    it.each([
      ['sum', 'Sum needs numbers, and name is text. Pick Count, Min or Max for it, or change its type with Change type.'],
      ['avg', 'Average needs numbers, and name is text. Pick Count, Min or Max for it, or change its type with Change type.'],
      ['stdev', 'StDev needs numbers, and name is text. Pick Count, Min or Max for it, or change its type with Change type.'],
    ] as const)('refuses %s of a column that isn’t a number', (total, message) => {
      expect(problems(orders([field('f1', 0, 'name', { total })], { joins: shop.joins }))).toEqual([message]);
    });

    it('lets text be counted, and its min and max taken', () => {
      expect(problems(orders([field('f1', 0, 'name', { total: 'count' }), field('f2', 0, 'status', { total: 'max' }), field('f3', 0, 'customer_id', { total: 'countDistinct' })], { joins: shop.joins }))).toEqual([]);
    });

    it('a Where field mustn’t show or sort, and needs criteria', () => {
      const where = (f: Partial<QueryField>) => problems(orders([field('f1', 1, 'customer_id'), field('f2', 1, 'status', { total: 'where', show: false, criteria: { op: '=', value: 'x' }, ...f })], { joins: shop.joins }));
      expect(where({})).toEqual([]);
      expect(where({ show: true })).toEqual(['status is a Where field: it filters rows before they’re grouped, so it can’t show. Turn off its Show, or pick another Total.']);
      expect(where({ criteria: undefined })).toEqual(['status is a Where field, so give it criteria to filter on, or pick another Total.']);
      expect(where({ sort: 'asc' })).toEqual(['status is a Where field, so the grouped result has no status to sort on. Turn off its sort.']);
    });

    it('an Expression field needs an expression that reads as one', () => {
      const expr = (expression?: string) => problems(orders([field('f1', 1, 'total', { total: 'expression', expression })], { joins: shop.joins }));
      expect(expr(' ')).toEqual(['Write the expression for total, such as sum(total), or pick another Total.']);
      expect(expr('sum(total); DROP TABLE x')).toEqual(['The expression for total can’t be read: use one expression, without ;.']);
      expect(expr('sum(total)')).toEqual([]);
      expect(problems(orders([field('f1', 1, 'total', { total: 'expression', expression: 'sum(total)', criteria: { op: '>', value: '' } })], { joins: shop.joins }))).toEqual(['Give the expression for total a value to compare with.']);
    });

    it('compares a summary by its own type', () => {
      expect(problems(orders([field('f1', 1, 'status', { total: 'count', criteria: { op: '>', value: 'two' } })], { joins: shop.joins }))).toEqual(['CountOfstatus is a number, so compare it with a number, not “two”.']);
      expect(problems(orders([field('f1', 1, 'status', { total: 'max', criteria: { op: '>', value: 'p' } })], { joins: shop.joins }))).toEqual([]);
      expect(problems(orders([field('f1', 1, 'status', { total: 'count', alias: 'Orders', criteria: { op: '>', value: 'two' } })], { joins: shop.joins }))).toEqual(['Orders is a number, so compare it with a number, not “two”.']);
    });

    it('refuses * with totals', () => {
      expect(problems(orders([field('f1', 0, '*')], { joins: shop.joins }))).toEqual(['Totals work on single fields, not customers.*. Take it out of the grid, or drag in the fields to group or summarise.']);
    });

    it('checks typed names against the summaries’ names', () => {
      const s = orders([field('f1', 1, 'total', { total: 'sum' }), field('f2', 1, 'order_id', { alias: 'sumoftotal' })], { joins: shop.joins });
      expect(problems(s)).toEqual(['Two fields are called sumoftotal. Give one of them another name.']);
    });

    it('says nothing about Totals while they’re off', () => {
      expect(problems(spec({ joins: shop.joins, fields: [field('f1', 0, 'name', { total: 'sum' }), field('f2', 1, 'status', { total: 'where' })] }))).toEqual([]);
    });
  });
});

describe('query nodes in a flow', () => {
  const shopFlow = (s: Partial<QuerySpec> = shop, wired: Array<[string, number]> = [['c', 0], ['o', 1]]) =>
    flow({
      sources: [src({ id: 'cust', format: 'csv' }), src({ id: 'ord', format: 'csv' })],
      nodes: [
        { id: 'c', type: 'source', sourceId: 'cust' },
        { id: 'o', type: 'source', sourceId: 'ord' },
        { id: 'q', type: 'query', querySpec: s },
        { id: 'out', type: 'output' },
      ],
      wires: [...wired.map(([from, port]) => [from, 'q', port] as [string, string, number]), ['q', 'out']],
    });
  const book = (p: ReturnType<typeof shopFlow>) => {
    const b = new SchemaBook();
    b.set(upstreamKey(p, { nodeId: 'c' }), CUSTOMERS);
    b.set(upstreamKey(p, { nodeId: 'o' }), ORDERS);
    return b;
  };

  it('compiles into the WITH chain over its inputs’ CTEs', () => {
    const p = shopFlow();
    const { sql } = compile(p, { nodeId: 'out' }, { schemas: book(p) });
    expect(sql).toContain('"n_q" AS (SELECT "t1"."name", "t2"."order_id", "t2"."total" FROM "n_c" AS "t1" INNER JOIN "n_o" AS "t2"');
  });

  it('compiles Totals into GROUP BY and HAVING on the same SELECT in the WITH chain', () => {
    const p = shopFlow({
      ...shop,
      totals: true,
      fields: [
        field('f1', 0, 'name', { sort: 'asc' }),
        field('f2', 1, 'total', { total: 'sum', criteria: { op: '>', value: '10' } }),
        field('f3', 1, 'order_id', { total: 'count', alias: 'Orders' }),
        field('f4', 1, 'status', { total: 'where', show: false, criteria: { op: '=', value: 'shipped' } }),
      ],
    });
    expect(compile(p, { nodeId: 'out' }, { schemas: book(p) }).sql).toMatchSnapshot();
  });

  it('is unwired with no tables, and pending until its tables’ columns are known', () => {
    expect(() => compile(shopFlow(shop, []), { nodeId: 'q' }, { schemas: new SchemaBook() })).toThrow(UnwiredError);
    expect(() => compile(shopFlow(), { nodeId: 'q' }, { schemas: new SchemaBook() })).toThrow(PendingSchemaError);
  });

  it('breaks with the first problem, pointing at the input it’s about', () => {
    const p = shopFlow({ ...shop, joins: [line('j1', [0, 'customer_id'], [1, 'status'])] });
    let error: unknown;
    try {
      compile(p, { nodeId: 'q' }, { schemas: book(p) });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CompileError);
    expect(error).toMatchObject({ nodeId: 'q', ports: [1] });
  });

  it('changes its cache key with the grid and lines, but not when a table moves in the designer', () => {
    const p = shopFlow();
    const key = upstreamKey(p, { nodeId: 'q' });
    expect(upstreamKey(shopFlow({ ...shop, tables: [{ port: 0, x: 400, y: 10 }] }), { nodeId: 'q' })).toBe(key);
    expect(upstreamKey(shopFlow({ ...shop, distinct: true }), { nodeId: 'q' })).not.toBe(key);
    expect(upstreamKey(shopFlow({ ...shop, totals: true }), { nodeId: 'q' })).not.toBe(key);
    expect(upstreamKey(shopFlow({ ...shop, joins: [line('j1', [0, 'customer_id'], [1, 'customer_id'], 'left')] }), { nodeId: 'q' })).not.toBe(key);
  });
});
