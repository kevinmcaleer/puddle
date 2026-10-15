// The Text step group on real DuckDB-WASM (Node build) against tests/fixtures/customers.csv.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileDisplayPage, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const cust = src({ id: 'cust', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(cust), new Uint8Array(readFileSync(join(__dirname, '../fixtures/customers.csv'))));
});
afterAll(() => engine.close());

/** One column of the step's output, as DuckDB prints it. */
async function column(type: string, params: Record<string, unknown>, name: string) {
  const p = flow({
    sources: [cust],
    nodes: [
      { id: 'in', type: 'source', sourceId: cust.id },
      { id: 't', type: 'transform', steps: [step('s', type, params)] },
    ],
    wires: [['in', 't']],
  });
  const columns = (await engine.describe(compile(p, { nodeId: 't' }).sql)).map((c) => c.name);
  return tableRows((await engine.query(compileDisplayPage(p, { nodeId: 't' }, columns, 0))).table).map((r) => r[name]);
}

describe('text steps', () => {
  it('finds and replaces plain text, with or without case, and by pattern', async () => {
    expect(await column('findReplace', { columns: ['email'], find: 'example', replace: 'test', regex: false, matchCase: true }, 'email')).toEqual([
      'ADA@test.com',
      'grace@test.com ',
      null,
      'null@test.com',
    ]);
    // Without case, ADA matches; the dot is literal, so it doesn't match any character.
    expect(await column('findReplace', { columns: ['email'], find: 'ada@', replace: '', regex: false, matchCase: false }, 'email')).toEqual([
      'example.com',
      'grace@example.com ',
      null,
      'null@example.com',
    ]);
    expect(await column('findReplace', { columns: ['email'], find: 'X.M', replace: '?', regex: false, matchCase: false }, 'email')).toEqual([
      'ADA@example.com',
      'grace@example.com ',
      null,
      'null@example.com',
    ]);
    expect(await column('findReplace', { columns: ['name'], find: '^\\s+|\\s+$', replace: '', regex: true, matchCase: true }, 'name')).toEqual([
      'Ada Lovelace',
      'grace hopper',
      'Edsger W. Dijkstra',
      '',
    ]);
    expect(await column('findReplace', { columns: ['joined'], find: '([0-9]{4})-([0-9]{2})', replace: '\\2/\\1', regex: true, matchCase: true }, 'joined')).toEqual([
      '01/2024-31',
      '02/2024-29',
      '03/2024-01',
      'not a date',
    ]);
  });

  it('extracts a prefix, a suffix, text between delimiters and a pattern group, empty on a miss', async () => {
    expect(await column('extractText', { column: 'joined', mode: 'prefix', length: 4, into: 'x' }, 'x')).toEqual(['2024', '2024', '2024', 'not ']);
    expect(await column('extractText', { column: 'joined', mode: 'suffix', length: 2, into: 'x' }, 'x')).toEqual(['31', '29', '01', 'te']);
    expect(await column('extractText', { column: 'email', mode: 'between', start: '@', end: '.', into: 'x' }, 'x')).toEqual(['example', 'example', null, 'example']);
    expect(await column('extractText', { column: 'joined', mode: 'regex', pattern: '-([0-9]+)$', group: 1, into: 'x' }, 'x')).toEqual(['31', '29', '01', null]);
  });

  it('pads to a length without cutting longer values, and measures length', async () => {
    expect(await column('padText', { columns: ['id'], length: 3, character: '0', side: 'start' }, 'id')).toEqual(['001', '002', '003', '004']);
    expect(await column('padText', { columns: ['joined'], length: 4, character: '.', side: 'end' }, 'joined')).toEqual(['2024-01-31', '2024-02-29', '2024-03-01', 'not a date']);
    expect(await column('textLength', { column: 'email', into: 'n' }, 'n')).toEqual(['15', '18', null, '16']);
  });
});
