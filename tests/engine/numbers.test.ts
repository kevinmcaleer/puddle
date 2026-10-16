// The Numbers group on real DuckDB-WASM (Node build) against tests/fixtures/numbers.csv, which has empty values.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileDisplayPage, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const numbers = src({ id: 'numbers', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(numbers), new Uint8Array(readFileSync(join(__dirname, '../fixtures/numbers.csv'))));
});
afterAll(() => engine.close());

async function run(type?: string, params: Record<string, unknown> = {}, before: Array<[type: string, params: Record<string, unknown>]> = []) {
  const steps = [...before, ...(type ? [[type, params] as const] : [])].map(([t, ps], i) => step(`s${i}`, t, ps));
  const p = flow({
    sources: [numbers],
    nodes: [
      { id: 'in', type: 'source', sourceId: numbers.id },
      { id: 't', type: 'transform', steps },
    ],
    wires: [['in', 't']],
  });
  const schema = await engine.describe(compile(p, { nodeId: 't' }).sql);
  const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId: 't' }, schema.map((c) => c.name), 0))).table);
  return { type: (name: string) => schema.find((c) => c.name === name)?.type, col: (name: string) => rows.map((r) => r[name]) };
}

const round = (columns: string[], mode: string, extra: Record<string, unknown> = {}) => run('roundNumbers', { columns, mode, places: 0, ...extra });

describe('the fixture', () => {
  it('reads as numbers with empty values', async () => {
    const r = await run();
    expect([r.type('amount'), r.type('temp_c'), r.type('score')]).toEqual(['DOUBLE', 'BIGINT', 'BIGINT']);
    expect(r.col('amount')[2]).toBeNull();
  });
});

describe('round', () => {
  it('rounds to places as written, halves away from zero, and leaves empty values empty', async () => {
    expect((await round(['amount', 'price'], 'places', { places: 2 })).col('price')).toEqual(['1.1', '2.68', null, '-0.5', '10.0']);
    expect((await round(['amount'], 'places', { places: 2 })).col('amount')).toEqual(['-12.35', '7.5', null, '1234.5', '0.0']);
    expect((await round(['amount'], 'places')).col('amount')).toEqual(['-12.0', '8.0', null, '1235.0', '0.0']);
  });

  it('rounds up and down at a number of places, without floating-point dust tipping it over', async () => {
    expect((await round(['amount'], 'up')).col('amount')).toEqual(['-12.0', '8.0', null, '1235.0', '0.0']);
    expect((await round(['amount'], 'down', { places: 1 })).col('amount')).toEqual(['-12.4', '7.5', null, '1234.5', '0.0']);
    // 1.1 * 10 is 11.000000000000002 as a double; rounding up must still give 1.1.
    expect((await round(['price'], 'up', { places: 1 })).col('price')).toEqual(['1.1', '2.7', null, '-0.5', '10.0']);
  });

  it('rounds to the nearest multiple', async () => {
    expect((await round(['amount'], 'nearest', { nearest: 0.25 })).col('amount')).toEqual(['-12.25', '7.5', null, '1234.5', '0.0']);
    expect((await round(['score'], 'nearest', { nearest: 25 })).col('score')).toEqual(['0.0', '25.0', '25.0', null, '50.0']);
  });

  it('given text, says to parse the numbers first', async () => {
    const asText: [string, Record<string, unknown>] = ['changeType', { columns: ['price'], to: 'text', onError: 'empty' }];
    await expect(run('roundNumbers', { columns: ['price'], mode: 'places', places: 1 }, [asText])).rejects.toThrow(/text where dates or numbers are needed. Add a Parse dates or Parse numbers step/);
    // Parse numbers first and it works.
    const parsed = await run('roundNumbers', { columns: ['price'], mode: 'places', places: 1 }, [asText, ['parseNumbers', { columns: ['price'], decimal: '.' }]]);
    expect(parsed.col('price')).toEqual(['1.1', '2.7', null, '-0.5', '10.0']);
  });
});

describe('absolute value', () => {
  it('drops the minus sign and keeps the type', async () => {
    const r = await run('absoluteValue', { columns: ['amount', 'temp_c'] });
    expect(r.col('amount')).toEqual(['12.345', '7.5', null, '1234.5', '0.0']);
    expect(r.type('temp_c')).toBe('BIGINT');
    expect(r.col('temp_c')).toEqual(['0', '100', '40', '37', null]);
  });
});

describe('bucket', () => {
  it('makes equal-width buckets with readable labels', async () => {
    expect((await run('bucketNumbers', { column: 'score', mode: 'width', width: 10, start: 0, edges: [], into: 'band' })).col('band')).toEqual([
      '10 to under 20',
      '20 to under 30',
      '30 to under 40',
      null,
      '40 to under 50',
    ]);
    expect((await run('bucketNumbers', { column: 'price', mode: 'width', width: 0.5, start: 0, edges: [], into: 'band' })).col('band')).toEqual([
      '1.0 to under 1.5',
      '2.5 to under 3.0',
      null,
      '-0.5 to under 0.0',
      '10.0 to under 10.5',
    ]);
  });

  it('buckets by custom edges, each including its lower edge', async () => {
    const r = await run('bucketNumbers', { column: 'amount', mode: 'edges', edges: [0, 10, 100], into: 'size' });
    expect(r.col('size')).toEqual(['under 0', '0 to under 10', null, '100 and over', '0 to under 10']);
    expect(r.type('size')).toBe('VARCHAR');
  });
});

describe('standardise', () => {
  it('scales to 0 to 1 by min and max', async () => {
    const r = await run('standardise', { columns: ['score'], method: 'minmax' });
    expect(r.type('score')).toBe('DOUBLE');
    expect(r.col('score').map((v) => (v == null ? v : Number(v)))).toEqual([0, expect.closeTo(1 / 3, 9), expect.closeTo(2 / 3, 9), null, 1]);
  });

  it('gives z-scores over the population, and 0 for a column that never varies', async () => {
    const z = (await run('standardise', { columns: ['score'], method: 'zscore' })).col('score').map((v) => (v == null ? v : Number(v)));
    const sd = Math.sqrt(125);
    expect(z).toEqual([expect.closeTo(-15 / sd, 9), expect.closeTo(-5 / sd, 9), expect.closeTo(5 / sd, 9), null, expect.closeTo(15 / sd, 9)]);
    expect((await run('standardise', { columns: ['flat'], method: 'zscore' })).col('flat')).toEqual(['0.0', '0.0', '0.0', '0.0', '0.0']);
    expect((await run('standardise', { columns: ['flat'], method: 'minmax' })).col('flat')).toEqual(['0.0', '0.0', '0.0', '0.0', '0.0']);
  });
});

describe('convert units', () => {
  it('converts temperatures by formula', async () => {
    expect((await run('convertUnits', { columns: ['temp_c'], from: 'c', to: 'f' })).col('temp_c')).toEqual(['32.0', '212.0', '-40.0', '98.6', null]);
    expect((await run('convertUnits', { columns: ['temp_c'], from: 'c', to: 'k' })).col('temp_c')).toEqual(['273.15', '373.15', '233.15', '310.15', null]);
  });

  it('converts lengths by factor, without floating-point dust', async () => {
    expect((await run('convertUnits', { columns: ['length_cm'], from: 'cm', to: 'in' })).col('length_cm')).toEqual(['1.0', '39.370078740157', null, '12.0', '0.0']);
    expect((await run('convertUnits', { columns: ['length_cm'], from: 'cm', to: 'm' })).col('length_cm')).toEqual(['0.0254', '1.0', null, '0.3048', '0.0']);
  });

  it('converts weight and volume', async () => {
    expect((await run('convertUnits', { columns: ['score'], from: 'lb', to: 'kg' })).col('score')).toEqual(['4.5359237', '9.0718474', '13.6077711', null, '18.1436948']);
    expect((await run('convertUnits', { columns: ['score'], from: 'ukgal', to: 'l' })).col('score')[0]).toBe('45.4609');
  });
});
