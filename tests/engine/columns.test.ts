// The Columns step group on real DuckDB-WASM (Node build) against tests/fixtures/customers.csv.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileDisplayPage, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import type { Source, Step } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const cust: Source = src({ id: 'cust', format: 'csv' });
const splits: Source = src({ id: 'splits', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(cust), new Uint8Array(readFileSync(join(__dirname, '../fixtures/customers.csv'))));
  await engine.registerBuffer(sourceFileName(splits), new Uint8Array(readFileSync(join(__dirname, '../fixtures/splits.csv'))));
});
afterAll(() => engine.close());

const project = (...steps: Step[]) => projectOn(cust, ...steps);
const projectOn = (source: Source, ...steps: Step[]) =>
  flow({
    sources: [source],
    nodes: [
      { id: 'in', type: 'source', sourceId: source.id },
      { id: 't', type: 'transform', steps },
    ],
    wires: [['in', 't']],
  });

/** The step's output as DuckDB prints it, and its column names and types. */
async function run(type: string, params: Record<string, unknown>, source = cust) {
  const p = projectOn(source, step('s', type, params));
  const schema = await engine.describe(compile(p, { nodeId: 't' }).sql);
  const columns = schema.map((c) => c.name);
  const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId: 't' }, columns, 0))).table);
  return { columns, types: Object.fromEntries(schema.map((c) => [c.name, c.type])), rows };
}

describe('columns steps', () => {
  it('moves columns to the front in the order given', async () => {
    expect((await run('reorderColumns', { columns: ['email', 'id'] })).columns).toEqual(['email', 'id', 'name', 'joined']);
  });

  it('changes type, emptying values that do not convert, or stopping when asked', async () => {
    const r = await run('changeType', { columns: ['joined'], to: 'date', onError: 'empty' });
    expect(r.types.joined).toBe('DATE');
    expect(r.rows.map((x) => x.joined)).toEqual(['2024-01-31', '2024-02-29', '2024-03-01', null]);
    expect((await run('changeType', { columns: ['id'], to: 'text', onError: 'empty' })).types.id).toBe('VARCHAR');
    await expect(run('changeType', { columns: ['joined'], to: 'date', onError: 'fail' })).rejects.toThrow(/not a date/);
  });

  it('splits by a delimiter, leaving missing parts empty', async () => {
    const r = await run('splitByDelimiter', { column: 'email', delimiter: '@', into: ['user', 'domain', 'extra'], keepOriginal: false });
    expect(r.columns).toEqual(['id', 'name', 'joined', 'user', 'domain', 'extra']);
    expect(r.rows[0]).toMatchObject({ user: 'ADA', domain: 'example.com', extra: null });
    expect(r.rows[2]).toMatchObject({ user: null, domain: null });
  });

  it('splits by position', async () => {
    const r = await run('splitByPosition', { column: 'joined', positions: [4, 5, 7], into: ['year', 'dash', 'month', 'rest'], keepOriginal: true });
    expect(r.columns).toEqual(['id', 'name', 'email', 'joined', 'year', 'dash', 'month', 'rest']);
    expect(r.rows[0]).toMatchObject({ year: '2024', dash: '-', month: '01', rest: '-31' });
  });

  // Split column, with Power Query's options, against tests/fixtures/splits.csv.
  const onSplits = (type: string, params: Record<string, unknown>) => run(type, { keepOriginal: false, ...params }, splits);
  const col = (r: { rows: Record<string, unknown>[] }, name: string) => r.rows.map((x) => x[name]);

  it('splits at each delimiter, leaving delimiters inside quotes alone when asked', async () => {
    const plain = await onSplits('splitByDelimiter', { column: 'line', delimiterKind: 'comma', into: ['a', 'b', 'c', 'd'] });
    expect(plain.rows[0]).toMatchObject({ a: 'one', b: '"two', c: ' three"', d: 'four' });
    const quoted = await onSplits('splitByDelimiter', { column: 'line', delimiterKind: 'comma', quote: '"', into: ['a', 'b', 'c'] });
    expect(quoted.columns).toEqual(['id', 'code', 'name', 'a', 'b', 'c']);
    expect(quoted.rows[0]).toMatchObject({ a: 'one', b: 'two, three', c: 'four' });
    expect(quoted.rows[1]).toMatchObject({ a: 'solo', b: null, c: null });
    expect(quoted.rows[2]).toMatchObject({ a: null, b: null });
  });

  it('splits once at the left-most or right-most delimiter', async () => {
    const left = await onSplits('splitByDelimiter', { column: 'line', delimiterKind: 'comma', quote: '"', at: 'left', into: ['first', 'rest'] });
    expect(left.rows[0]).toMatchObject({ first: 'one', rest: '"two, three",four' });
    expect(left.rows[1]).toMatchObject({ first: 'solo', rest: null });
    const right = await onSplits('splitByDelimiter', { column: 'line', delimiterKind: 'custom', delimiter: ',', at: 'right', into: ['start', 'last'] });
    expect(right.rows[0]).toMatchObject({ start: 'one,"two, three"', last: 'four' });
  });

  it('splits into rows, keeping a row for an empty value', async () => {
    const r = await onSplits('splitByDelimiter', { column: 'line', delimiterKind: 'comma', quote: '"', to: 'rows' });
    expect(r.columns).toEqual(['id', 'line', 'code', 'name']);
    expect(r.rows.map((x) => [x.id, x.line])).toEqual([['1', 'one'], ['1', 'two, three'], ['1', 'four'], ['2', 'solo'], ['3', null]]);
  });

  it('splits by named delimiters such as a space', async () => {
    const r = await onSplits('splitByDelimiter', { column: 'line', delimiterKind: 'space', into: ['a', 'b'], keepOriginal: true });
    expect(r.rows[0]).toMatchObject({ line: 'one,"two, three",four', a: 'one,"two,', b: 'three",four' });
  });

  it('splits by number of characters: repeatedly, or once from the left or right', async () => {
    const repeat = await onSplits('splitByCharacters', { column: 'code', count: 3, into: ['p1', 'p2', 'p3'] });
    expect(repeat.rows.map((x) => [x.p1, x.p2, x.p3])).toEqual([['ABC', '123', 'def'], ['12a', 'b', null], ['A', null, null]]);
    const left = await onSplits('splitByCharacters', { column: 'code', count: 2, at: 'left', into: ['head', 'tail'] });
    expect(left.rows.map((x) => [x.head, x.tail])).toEqual([['AB', 'C123def'], ['12', 'ab'], ['A', null]]);
    const right = await onSplits('splitByCharacters', { column: 'code', count: 3, at: 'right', into: ['head', 'tail'] });
    expect(right.rows.map((x) => [x.head, x.tail])).toEqual([['ABC123', 'def'], ['1', '2ab'], [null, 'A']]);
    const rows = await onSplits('splitByCharacters', { column: 'code', count: 4, to: 'rows' });
    expect(col(rows, 'code')).toEqual(['ABC1', '23de', 'f', '12ab', 'A']);
  });

  it('splits by character transition', async () => {
    expect(col(await onSplits('splitByTransition', { column: 'name', transition: 'lowerUpper', to: 'rows' }), 'name')).toEqual(['hello', 'World', 'Foo', 'Plain', null]);
    const digits = await onSplits('splitByTransition', { column: 'code', transition: 'nonDigitDigit', into: ['a', 'b'] });
    expect(digits.rows[0]).toMatchObject({ a: 'ABC', b: '123def' });
    const nonDigits = await onSplits('splitByTransition', { column: 'code', transition: 'digitNonDigit', into: ['a', 'b'] });
    expect(nonDigits.rows[0]).toMatchObject({ a: 'ABC123', b: 'def' });
    expect(nonDigits.rows[1]).toMatchObject({ a: '12', b: 'ab' });
    const upper = await onSplits('splitByTransition', { column: 'code', transition: 'upperLower', into: ['a', 'b'] });
    expect(upper.rows[0]).toMatchObject({ a: 'ABC123def', b: null });
  });

  it('splits by position into rows', async () => {
    const r = await onSplits('splitByPosition', { column: 'code', positions: [3, 6], to: 'rows' });
    expect(col(r, 'code')).toEqual(['ABC', '123', 'def', '12a', 'b', '', 'A', '', '']);
  });

  it('merges columns, skipping empty values', async () => {
    const r = await run('mergeColumns', { columns: ['id', 'email'], separator: ' / ', into: 'key', keepOriginals: false });
    expect(r.columns).toEqual(['name', 'joined', 'key']);
    expect(r.rows.map((x) => x.key)).toEqual(['1 / ADA@example.com', '2 / grace@example.com ', '3', '4 / null@example.com']);
  });

  it('adds an index from the start number, in file order', async () => {
    const r = await run('addIndex', { name: 'row', start: 0 });
    expect(r.columns[0]).toBe('row');
    expect(r.rows.map((x) => [x.row, x.id])).toEqual([['0', '1'], ['1', '2'], ['2', '3'], ['3', '4']]);
  });

  it('duplicates a column under a new name', async () => {
    const r = await run('duplicateColumn', { column: 'id', into: 'id copy' });
    expect(r.rows.map((x) => x['id copy'])).toEqual(['1', '2', '3', '4']);
  });

  it('adds a column from an expression, and a bad expression names the problem', async () => {
    const r = await run('addColumn', { name: 'domain', expression: "split_part(email, '@', 2)" });
    expect(r.rows.map((x) => x.domain)).toEqual(['example.com', 'example.com ', null, 'example.com']);
    await expect(run('addColumn', { name: 'x', expression: 'nope + 1' })).rejects.toThrow(/nope/);
  });

  it('a later step that needs a removed column fails', async () => {
    const p = project(step('a', 'removeColumns', { columns: ['email'] }), step('b', 'duplicateColumn', { column: 'email', into: 'e2' }));
    await expect(engine.query(compile(p, { nodeId: 't' }).sql)).rejects.toThrow(/email/);
  });
});
