import { flow, src, step } from '../../tests/helpers/projects';
import { JOIN_KINDS, type ColumnSchema, type JoinSpec } from '../model';
import { compile, compileJoinCheck, upstreamKey } from './compile';
import { CompileError, PendingSchemaError, UnwiredError } from './errors';
import { joinColumns, joinProblems, suggestJoinKey } from './join';
import { SchemaBook } from './schemaBook';
import { SchemaCache } from './schemaCache';

const ORDERS: ColumnSchema[] = [
  { name: 'order_id', type: 'BIGINT' },
  { name: 'customer_id', type: 'BIGINT' },
  { name: 'status', type: 'VARCHAR' },
];
const CUSTOMERS: ColumnSchema[] = [
  { name: 'customer_id', type: 'INTEGER' },
  { name: 'name', type: 'VARCHAR' },
  { name: 'status', type: 'VARCHAR' },
];

const spec = (s: Partial<JoinSpec> = {}): JoinSpec => ({ kind: 'left', keys: [{ left: 'customer_id', right: 'customer_id' }], suffix: '_right', ...s });

const shop = (s: Partial<JoinSpec> = {}, rightSteps = [] as ReturnType<typeof step>[]) =>
  flow({
    sources: [src({ id: 'orders', format: 'csv' }), src({ id: 'customers', format: 'csv' })],
    nodes: [
      { id: 'o', type: 'source', sourceId: 'orders' },
      { id: 'c', type: 'source', sourceId: 'customers' },
      { id: 'rc', type: 'transform', steps: rightSteps },
      { id: 'j', type: 'join', joinSpec: spec(s) },
      { id: 'out', type: 'output' },
    ],
    wires: [['o', 'j', 'left'], ['c', 'rc'], ['rc', 'j', 'right'], ['j', 'out']],
  });

/** A book that knows both inputs of the shop flow. */
function bookFor(p: ReturnType<typeof shop>, left = ORDERS, right = CUSTOMERS) {
  const book = new SchemaBook();
  book.set(upstreamKey(p, { nodeId: 'o' }), left);
  book.set(upstreamKey(p, { nodeId: 'rc' }), right);
  return book;
}

describe('join SQL', () => {
  it.each(JOIN_KINDS)('%s join over both inputs’ CTEs', (kind) => {
    const p = shop({ kind });
    expect(compile(p, { nodeId: 'out' }, { schemas: bookFor(p) }).sql).toMatchSnapshot();
  });

  it('matches on every key pair', () => {
    const p = shop({ kind: 'inner', keys: [{ left: 'customer_id', right: 'customer_id' }, { left: 'status', right: 'status' }] });
    expect(compile(p, { nodeId: 'j' }, { schemas: bookFor(p) }).sql).toContain('ON "l"."customer_id" = "r"."customer_id" AND "l"."status" = "r"."status"');
  });

  it('counts inputs, output and matches for the multiplication warning', () => {
    const p = shop();
    expect(compileJoinCheck(p, 'j', { schemas: bookFor(p) })).toMatchSnapshot();
    expect(() => compileJoinCheck(p, 'o', { schemas: bookFor(p) })).toThrow(/isn’t a Join/);
  });
});

describe('join columns', () => {
  const names = (s: Partial<JoinSpec>, left = ORDERS, right = CUSTOMERS) => joinColumns(spec(s), left, right).map((c) => c.name);

  it('drops a right key named like its left key and suffixes clashing names', () => {
    expect(names({})).toEqual(['order_id', 'customer_id', 'status', 'name', 'status_right']);
  });

  it('keeps a right key with a different name', () => {
    expect(names({ keys: [{ left: 'customer_id', right: 'id' }] }, ORDERS, [{ name: 'id', type: 'BIGINT' }, { name: 'name', type: 'VARCHAR' }])).toEqual(['order_id', 'customer_id', 'status', 'id', 'name']);
  });

  it('numbers a suffixed name that is already taken, and leaves right columns that don’t clash alone', () => {
    const right = [...CUSTOMERS, { name: 'status_right', type: 'VARCHAR' }];
    expect(names({}, ORDERS, right)).toEqual(['order_id', 'customer_id', 'status', 'name', 'status_right2', 'status_right']);
    expect(names({ suffix: '_c' })).toEqual(['order_id', 'customer_id', 'status', 'name', 'status_c']);
  });

  it('fills a shared key from the right in right and full joins', () => {
    for (const kind of ['right', 'full'] as const) expect(joinColumns(spec({ kind }), ORDERS, CUSTOMERS)[1]!.sql).toBe('coalesce("l"."customer_id", "r"."customer_id") AS "customer_id"');
    expect(joinColumns(spec({ kind: 'inner' }), ORDERS, CUSTOMERS)[1]!.sql).toBe('"l"."customer_id"');
  });

  it('anti and semi joins keep only the left columns', () => {
    expect(names({ kind: 'anti' })).toEqual(['order_id', 'customer_id', 'status']);
    expect(names({ kind: 'semi' })).toEqual(['order_id', 'customer_id', 'status']);
  });
});

describe('suggested key', () => {
  it('prefers a shared id-like column of a comparable type, skipping ones in use', () => {
    expect(suggestJoinKey(ORDERS, CUSTOMERS)).toEqual({ left: 'customer_id', right: 'customer_id' });
    expect(suggestJoinKey(ORDERS, CUSTOMERS, ['customer_id'])).toEqual({ left: 'status', right: 'status' });
    expect(suggestJoinKey(ORDERS, [{ name: 'customer_id', type: 'VARCHAR' }])).toBeUndefined();
    expect(suggestJoinKey(ORDERS, [{ name: 'other', type: 'BIGINT' }])).toBeUndefined();
  });
});

describe('join problems', () => {
  it('asks for keys, and for both columns of each pair', () => {
    expect(joinProblems(spec({ keys: [] }))).toEqual([{ field: 'keys', message: 'Pick the columns to match on, one from each side.' }]);
    expect(joinProblems(spec({ keys: [{ left: '', right: '' }] })).map((p) => p.message)).toEqual(['Pick a left column for key 1.', 'Pick a right column for key 1.']);
  });

  it('says which side lost a key column', () => {
    expect(joinProblems(spec({ keys: [{ left: 'cust', right: 'customer_id' }] }), ORDERS, CUSTOMERS)).toEqual([{ key: 0, side: 'left', message: 'cust isn’t in the left input any more.' }]);
    expect(joinProblems(spec(), ORDERS, CUSTOMERS.slice(1))).toEqual([{ key: 0, side: 'right', message: 'customer_id isn’t in the right input any more.' }]);
  });

  it('explains a type mismatch in words, and allows numbers of different sizes', () => {
    const text = [{ name: 'customer_id', type: 'VARCHAR' }];
    expect(joinProblems(spec(), ORDERS, CUSTOMERS)).toEqual([]);
    expect(joinProblems(spec(), text, ORDERS)[0]!.message).toBe('customer_id is text on the left and a number on the right; change one with Change type.');
    expect(joinProblems(spec({ keys: [{ left: 'customer_id', right: 'joined' }] }), ORDERS, [{ name: 'joined', type: 'DATE' }])[0]!.message).toBe(
      'customer_id on the left is a number and joined on the right is a date; change one with Change type.',
    );
    expect(joinProblems(spec({ keys: [{ left: 'd', right: 't' }] }), [{ name: 'd', type: 'DATE' }], [{ name: 't', type: 'TIMESTAMP' }])).toEqual([]);
  });

  it('needs a suffix only when right columns are kept', () => {
    expect(joinProblems(spec({ suffix: ' ' }))).toEqual([{ field: 'suffix', message: 'Give clashing columns a suffix, such as _right.' }]);
    expect(joinProblems(spec({ suffix: '', kind: 'semi' }))).toEqual([]);
  });
});

describe('compiling a join node', () => {
  it('is unwired until both inputs have a wire, naming the empty one', () => {
    const p = shop();
    const noRight = { ...p, edges: p.edges.filter((e) => e.to.port !== 'right') };
    expect(() => compile(noRight, { nodeId: 'j' }, { schemas: bookFor(p) })).toThrow(new UnwiredError('j has no right input. Connect a wire into it.', 'j', 'right'));
  });

  it('waits for its inputs’ columns, then checks its keys against them', () => {
    const p = shop();
    expect(() => compile(p, { nodeId: 'j' }, { schemas: new SchemaBook() })).toThrow(PendingSchemaError);
    let err: unknown;
    try {
      compile(p, { nodeId: 'j' }, { schemas: bookFor(p, ORDERS, CUSTOMERS.slice(1)) });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CompileError);
    expect(err).toMatchObject({ message: 'customer_id isn’t in the right input any more.', nodeId: 'j', ports: ['right'] });
  });

  it('reports a missing key before waiting for columns', () => {
    expect(() => compile(shop({ keys: [] }), { nodeId: 'j' }, { schemas: new SchemaBook() })).toThrow(/Pick the columns to match on/);
  });
});

describe('upstreamKey across branches', () => {
  it('changes with either branch, the wiring ports and the join settings', () => {
    const p = shop();
    const key = upstreamKey(p, { nodeId: 'out' });
    expect(upstreamKey(shop({}, [step('s', 'trimWhitespace', { columns: ['name'] })]), { nodeId: 'out' })).not.toBe(key);
    expect(upstreamKey(shop({ kind: 'inner' }), { nodeId: 'out' })).not.toBe(key);
    expect(upstreamKey(shop({ suffix: '_c' }), { nodeId: 'out' })).not.toBe(key);
    const swapped = { ...p, edges: p.edges.map((e) => (e.to.nodeId === 'j' ? { ...e, to: { ...e.to, port: e.to.port === 'left' ? ('right' as const) : ('left' as const) } } : e)) };
    expect(upstreamKey(swapped, { nodeId: 'out' })).not.toBe(key);
    // The left branch's own key doesn't depend on the right branch.
    expect(upstreamKey(shop({}, [step('s', 'trimWhitespace', { columns: ['name'] })]), { nodeId: 'o' })).toBe(upstreamKey(p, { nodeId: 'o' }));
  });
});

describe('schema cache with joins', () => {
  it('describes both inputs before the join, and records every schema in its book', async () => {
    const p = shop();
    const described: string[] = [];
    const book = new SchemaBook();
    const cache = new SchemaCache(
      async (sql) => {
        described.push(sql);
        if (sql.includes('JOIN')) return [{ name: 'joined', type: 'BIGINT' }];
        return sql.includes('src_orders') && !sql.includes('src_customers') ? ORDERS : CUSTOMERS;
      },
      500,
      book,
    );
    expect(await cache.get(p, { nodeId: 'out' })).toEqual([{ name: 'joined', type: 'BIGINT' }]);
    expect(described).toHaveLength(3);
    expect(book.get(upstreamKey(p, { nodeId: 'o' }))).toEqual(ORDERS);
    expect(book.get(upstreamKey(p, { nodeId: 'rc' }))).toEqual(CUSTOMERS);
    // Again: everything is cached.
    await cache.get(p, { nodeId: 'out' });
    expect(described).toHaveLength(3);
    // The join itself: its inputs are known, so only it is described.
    await cache.get(p, { nodeId: 'j' });
    expect(described).toHaveLength(4);
    cache.clear();
    expect(book.size).toBe(0);
  });
});
