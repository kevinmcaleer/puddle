import { flow, src } from '../../tests/helpers/projects';
import type { ColumnSchema, QueryField, QueryJoin, QuerySpec } from '../model';
import { compile, upstreamKey } from './compile';
import { CompileError, PendingSchemaError, UnwiredError } from './errors';
import { compileQuery, crossJoinedTables, joinPlan, queryColumns, queryProblems, type QueryTable } from './query';
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
const spec = (s: Partial<QuerySpec>): QuerySpec => ({ tables: [], joins: [], fields: [], distinct: false, ...s });

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
    expect(upstreamKey(shopFlow({ ...shop, joins: [line('j1', [0, 'customer_id'], [1, 'customer_id'], 'left')] }), { nodeId: 'q' })).not.toBe(key);
  });
});
