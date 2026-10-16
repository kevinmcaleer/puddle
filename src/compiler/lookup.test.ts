import { flow, src } from '../../tests/helpers/projects';
import type { ColumnSchema, LookupSpec } from '../model';
import { compile, compileLookupCheck, upstreamKey } from './compile';
import { CompileError, PendingSchemaError, UnwiredError } from './errors';
import { lookupColumns, lookupProblems, suggestLookupColumns } from './lookup';
import { SchemaBook } from './schemaBook';

const ORDERS: ColumnSchema[] = [
  { name: 'order_id', type: 'BIGINT' },
  { name: 'customer_id', type: 'BIGINT' },
  { name: 'status', type: 'VARCHAR' },
];
const CUSTOMERS: ColumnSchema[] = [
  { name: 'customer_id', type: 'INTEGER' },
  { name: 'name', type: 'VARCHAR' },
  { name: 'status', type: 'VARCHAR' },
  { name: 'joined', type: 'DATE' },
];

const spec = (s: Partial<LookupSpec> = {}): LookupSpec => ({ keys: [{ main: 'customer_id', lookup: 'customer_id' }], columns: ['name'], suffix: '_lookup', useDefault: false, defaultValue: '', ...s });

const shop = (s: Partial<LookupSpec> = {}, wires: Array<[string, string, 'main' | 'lookup']> = [['o', 'k', 'main'], ['c', 'k', 'lookup']]) =>
  flow({
    sources: [src({ id: 'orders', format: 'csv' }), src({ id: 'customers', format: 'csv' })],
    nodes: [
      { id: 'o', type: 'source', sourceId: 'orders' },
      { id: 'c', type: 'source', sourceId: 'customers' },
      { id: 'k', type: 'lookup', lookupSpec: spec(s) },
      { id: 'out', type: 'output' },
    ],
    wires: [...wires, ['k', 'out']],
  });

function bookFor(p: ReturnType<typeof shop>) {
  const book = new SchemaBook();
  book.set(upstreamKey(p, { nodeId: 'o' }), ORDERS);
  book.set(upstreamKey(p, { nodeId: 'c' }), CUSTOMERS);
  return book;
}

describe('lookup SQL', () => {
  it.each([
    ['one column', {}],
    ['a clashing column and a default', { columns: ['name', 'status'], useDefault: true, defaultValue: ' n/a ' }],
    ['two keys', { keys: [{ main: 'customer_id', lookup: 'customer_id' }, { main: 'status', lookup: 'status' }] }],
  ])('%s', (_, s) => {
    const p = shop(s);
    expect(compile(p, { nodeId: 'out' }, { schemas: bookFor(p) }).sql).toMatchSnapshot();
  });

  it('counts matches, duplicate keys and missing keys in one row', () => {
    const p = shop();
    expect(compileLookupCheck(p, 'k', { schemas: bookFor(p) })).toMatchSnapshot();
    expect(() => compileLookupCheck(p, 'o', { schemas: bookFor(p) })).toThrow(/isn’t a Lookup/);
  });

  it('is unwired without either input, and waits for its inputs’ columns', () => {
    const p = shop({}, [['o', 'k', 'main']]);
    expect(() => compile(p, { nodeId: 'k' }, { schemas: bookFor(p) })).toThrow(new UnwiredError('k has no lookup input. Connect a wire into it.', 'k', 'lookup'));
    expect(() => compile(shop(), { nodeId: 'k' }, { schemas: new SchemaBook() })).toThrow(PendingSchemaError);
  });

  it('refuses to compile a lost lookup column, blaming the lookup input', () => {
    const p = shop({ columns: ['phone'] });
    let err: unknown;
    try {
      compile(p, { nodeId: 'k' }, { schemas: bookFor(p) });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CompileError);
    expect(err).toMatchObject({ message: 'phone isn’t in the lookup input any more.', ports: ['lookup'] });
  });

  it('keys the cache on its settings and which input is which', () => {
    const key = upstreamKey(shop(), { nodeId: 'k' });
    expect(upstreamKey(shop({ columns: ['status'] }), { nodeId: 'k' })).not.toBe(key);
    expect(upstreamKey(shop({ defaultValue: 'x' }), { nodeId: 'k' })).not.toBe(key);
    expect(upstreamKey(shop({}, [['c', 'k', 'main'], ['o', 'k', 'lookup']]), { nodeId: 'k' })).not.toBe(key);
  });
});

describe('lookup columns', () => {
  it('suffixes a brought column the main input has, numbering it when the suffixed name is taken', () => {
    expect(lookupColumns(spec({ columns: ['name', 'status'] }), ORDERS)).toEqual([
      { name: 'name', from: 'name' },
      { name: 'status_lookup', from: 'status' },
    ]);
    expect(lookupColumns(spec({ columns: ['status'] }), [...ORDERS, { name: 'status_lookup', type: 'VARCHAR' }])).toEqual([{ name: 'status_lookup2', from: 'status' }]);
  });

  it('suggests the lookup’s new columns, or every one but the key', () => {
    expect(suggestLookupColumns(ORDERS, CUSTOMERS, 'customer_id')).toEqual(['name', 'joined']);
    expect(suggestLookupColumns(CUSTOMERS, CUSTOMERS, 'customer_id')).toEqual(['name', 'status', 'joined']);
  });
});

describe('lookup problems', () => {
  it('asks for keys and columns', () => {
    expect(lookupProblems(spec({ keys: [], columns: [] })).map((p) => p.message)).toEqual(['Pick the columns to match on: one from the main input, one from the lookup.', 'Pick at least one column to bring across.']);
    expect(lookupProblems(spec({ keys: [{ main: '', lookup: '' }] })).map((p) => p.message)).toEqual(['Pick a main column for key 1.', 'Pick a lookup column for key 1.']);
  });

  it('says which side lost a key column, and explains a type mismatch', () => {
    expect(lookupProblems(spec({ keys: [{ main: 'cust', lookup: 'customer_id' }] }), ORDERS, CUSTOMERS)).toEqual([{ key: 0, side: 'main', message: 'cust isn’t in the main input any more.' }]);
    expect(lookupProblems(spec({ keys: [{ main: 'customer_id', lookup: 'joined' }] }), ORDERS, CUSTOMERS)[0]!.message).toBe(
      'customer_id in the main input is a number and joined in the lookup is a date; change one with Change type.',
    );
    expect(lookupProblems(spec(), ORDERS, CUSTOMERS)).toEqual([]);
  });

  it('needs a suffix only when a brought column clashes', () => {
    expect(lookupProblems(spec({ suffix: '' }), ORDERS, CUSTOMERS)).toEqual([]);
    expect(lookupProblems(spec({ suffix: ' ', columns: ['status'] }), ORDERS, CUSTOMERS)).toEqual([{ field: 'suffix', message: 'Give clashing columns a suffix, such as _lookup.' }]);
  });

  it('checks the default fits every brought column', () => {
    const fill = (defaultValue: string, columns: string[]) => lookupProblems(spec({ useDefault: true, defaultValue, columns }), ORDERS, CUSTOMERS);
    expect(fill('anything at all', ['name'])).toEqual([]);
    expect(fill('2024-01-31', ['joined'])).toEqual([]);
    expect(fill('-1.5', ['customer_id'])).toEqual([]);
    expect(fill('soon', ['name', 'joined'])).toEqual([{ field: 'defaultValue', message: 'joined is a date, so it can’t be filled with “soon”. Change the default, or leave joined out.' }]);
    // Unused when off.
    expect(lookupProblems(spec({ useDefault: false, defaultValue: 'soon', columns: ['joined'] }), ORDERS, CUSTOMERS)).toEqual([]);
  });
});
