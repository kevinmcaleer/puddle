import { flow, src } from '../../tests/helpers/projects';
import type { AppendSpec, ColumnSchema } from '../model';
import { appendColumns, appendProblems, type AppendInput } from './append';
import { compile, upstreamKey } from './compile';
import { CompileError, PendingSchemaError, UnwiredError } from './errors';
import { SchemaBook } from './schemaBook';
import { describeType, typesFit } from './types';

const CUSTOMERS: ColumnSchema[] = [
  { name: 'id', type: 'BIGINT' },
  { name: 'name', type: 'VARCHAR' },
];
const MORE: ColumnSchema[] = [
  { name: 'Name', type: 'VARCHAR' },
  { name: 'id', type: 'INTEGER' },
  { name: 'phone', type: 'VARCHAR' },
];

// Lined up by place with CUSTOMERS, under other names.
const BY_PLACE: ColumnSchema[] = [
  { name: 'customer_id', type: 'INTEGER' },
  { name: 'full_name', type: 'VARCHAR' },
  { name: 'phone', type: 'VARCHAR' },
];

const spec = (s: Partial<AppendSpec> = {}): AppendSpec => ({ match: 'name', tagRows: false, tagColumn: 'source', ...s });
const inputs = (...cols: ColumnSchema[][]): AppendInput[] => cols.map((columns, i) => ({ label: `in${i + 1}`, columns }));

const stack = (s: Partial<AppendSpec> = {}, wired: Array<[string, number]> = [['c', 0], ['m', 1]]) =>
  flow({
    sources: [src({ id: 'cust', format: 'csv' }), src({ id: 'more', format: 'csv' })],
    nodes: [
      { id: 'c', type: 'source', sourceId: 'cust' },
      { id: 'm', type: 'source', sourceId: 'more' },
      { id: 'a', type: 'append', appendSpec: s },
      { id: 'out', type: 'output' },
    ],
    wires: [...wired.map(([from, port]) => [from, 'a', port] as [string, string, number]), ['a', 'out']],
  });

function bookFor(p: ReturnType<typeof stack>, c = CUSTOMERS, m = MORE) {
  const book = new SchemaBook();
  book.set(upstreamKey(p, { nodeId: 'c' }), c);
  book.set(upstreamKey(p, { nodeId: 'm' }), m);
  return book;
}

describe('append SQL', () => {
  it.each([
    ['by name', {}, MORE],
    ['by name with a source column', { tagRows: true, tagColumn: 'from' }, MORE],
    ['by position', { match: 'position' as const }, BY_PLACE],
    ['by position with a source column', { match: 'position' as const, tagRows: true }, BY_PLACE],
  ])('%s', (_, s, more) => {
    const p = stack(s);
    expect(compile(p, { nodeId: 'out' }, { schemas: bookFor(p, CUSTOMERS, more) }).sql).toMatchSnapshot();
  });

  it('stacks inputs in port order, skipping an empty input', () => {
    const p = stack({}, [['m', 3], ['c', 1]]);
    const sql = compile(p, { nodeId: 'a' }, { schemas: bookFor(p) }).sql;
    expect(sql).toContain('SELECT * FROM "n_c" UNION ALL BY NAME SELECT * FROM "n_m"');
  });

  it('is unwired with fewer than two inputs, pointing at the next free one', () => {
    const p = stack({}, [['c', 0]]);
    expect(() => compile(p, { nodeId: 'a' }, { schemas: bookFor(p) })).toThrow(new UnwiredError('a needs at least two inputs. Connect another wire into it.', 'a', 1));
  });

  it('waits for its inputs’ columns', () => {
    expect(() => compile(stack(), { nodeId: 'a' }, { schemas: new SchemaBook() })).toThrow(PendingSchemaError);
  });

  it('refuses to compile a clash, blaming the input that clashes', () => {
    const p = stack();
    const err = (() => {
      try {
        compile(p, { nodeId: 'a' }, { schemas: bookFor(p, CUSTOMERS, [{ name: 'id', type: 'VARCHAR' }]) });
      } catch (e) {
        return e;
      }
    })() as CompileError;
    expect(err).toBeInstanceOf(CompileError);
    expect(err.message).toBe('id is a number in c and text in m; change one with Change type.');
    expect(err.ports).toEqual([1]);
  });

  it('keys the cache on its settings, its inputs’ order and, with a source column, their names', () => {
    const p = stack();
    const key = upstreamKey(p, { nodeId: 'a' });
    expect(upstreamKey(stack({ match: 'position' }), { nodeId: 'a' })).not.toBe(key);
    expect(upstreamKey(stack({}, [['m', 0], ['c', 1]]), { nodeId: 'a' })).not.toBe(key);
    const rename = (q: typeof p) => ({ ...q, nodes: q.nodes.map((n) => (n.id === 'c' ? { ...n, name: 'Customers' } : n)) });
    expect(upstreamKey(rename(p), { nodeId: 'a' })).toBe(key);
    const tagged = stack({ tagRows: true });
    expect(upstreamKey(rename(tagged), { nodeId: 'a' })).not.toBe(upstreamKey(tagged, { nodeId: 'a' }));
  });
});

describe('append columns', () => {
  it('by name: every column, first seen first, matched without regard to case, and where each came from', () => {
    expect(appendColumns(spec(), inputs(CUSTOMERS, MORE))).toEqual([
      { name: 'id', type: 'BIGINT', from: [0, 1] },
      { name: 'name', type: 'VARCHAR', from: [0, 1] },
      { name: 'phone', type: 'VARCHAR', from: [1] },
    ]);
  });

  it('by position: names from the first input, the widest input sets the count', () => {
    expect(appendColumns(spec({ match: 'position' }), inputs(CUSTOMERS, MORE)).map((c) => [c.name, c.from])).toEqual([
      ['id', [0, 1]],
      ['name', [0, 1]],
      ['phone', [1]],
    ]);
  });

  it('puts the source column last', () => {
    expect(appendColumns(spec({ tagRows: true, tagColumn: ' from ' }), inputs(CUSTOMERS, MORE)).at(-1)).toEqual({ name: 'from', type: 'VARCHAR', from: [0, 1] });
  });
});

describe('append problems', () => {
  it('finds none when types fit, numbers of any size included', () => {
    expect(appendProblems(spec(), inputs(CUSTOMERS, MORE))).toEqual([]);
    expect(appendProblems(spec(), inputs([{ name: 'x', type: 'DATE' }], [{ name: 'x', type: 'TIMESTAMP' }], [{ name: 'x', type: '"NULL"' }]))).toEqual([]);
  });

  it('names the column and both inputs when types clash', () => {
    expect(appendProblems(spec(), inputs(CUSTOMERS, CUSTOMERS, [{ name: 'ID', type: 'DATE' }]))).toEqual([{ input: 2, message: 'id is a number in in1 and a date in in3; change one with Change type.' }]);
  });

  it('by position, names the column by place when the names differ', () => {
    expect(appendProblems(spec({ match: 'position' }), inputs(CUSTOMERS, [{ name: 'code', type: 'VARCHAR' }]))[0]!.message).toBe(
      'Column 1 (id, code) is a number in in1 and text in in2; change one with Change type.',
    );
  });

  it('needs a free name for the source column', () => {
    expect(appendProblems(spec({ tagRows: true, tagColumn: ' ' }), inputs(CUSTOMERS, MORE))).toEqual([{ field: 'tagColumn', message: 'Name the column that says which input each row came from.' }]);
    expect(appendProblems(spec({ tagRows: true, tagColumn: 'Phone' }), inputs(CUSTOMERS, MORE))[0]!.message).toBe('There’s already a column called Phone. Pick another name for the source column.');
  });
});

describe('types', () => {
  it('groups types into families and says them in words', () => {
    expect(typesFit('BIGINT', 'DECIMAL(18,3)')).toBe(true);
    expect(typesFit('VARCHAR', 'INTEGER')).toBe(false);
    expect(typesFit('BOOLEAN', 'INTEGER')).toBe(false);
    expect(typesFit('"NULL"', 'BOOLEAN')).toBe(true);
    expect(['DOUBLE', 'VARCHAR', 'TIMESTAMP WITH TIME ZONE', 'TIME', 'BOOLEAN', 'BLOB'].map(describeType)).toEqual(['a number', 'text', 'a date', 'a time', 'true or false', 'BLOB']);
  });
});
