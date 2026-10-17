// Date format detection and parsing on real DuckDB-WASM (Node build) against tests/fixtures/dates.csv.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileDisplayPage, sourceFileName } from '../../src/compiler';
import { detectDateFormats, unreadValues } from '../../src/dates';
import { EngineClient, tableRows } from '../../src/engine/client';
import type { Project } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const dates = src({ id: 'dates', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(dates), new Uint8Array(readFileSync(join(__dirname, '../fixtures/dates.csv'))));
});
afterAll(() => engine.close());

const project = (steps: ReturnType<typeof step>[] = [], defaultDateFormats: string[] = []): Project => {
  const p = flow({
    sources: [dates],
    nodes: [
      { id: 'in', type: 'source', sourceId: dates.id },
      { id: 't', type: 'transform', steps },
    ],
    wires: [['in', 't']],
  });
  return { ...p, settings: { ...p.settings, defaultDateFormats } };
};

const detect = (column: string, defaults: string[] = []) => detectDateFormats(engine, project([], defaults), { nodeId: 't' }, column);
const top = (d: Awaited<ReturnType<typeof detect>>, n = 2) => d.ranked.slice(0, n).map((m) => `${m.format} ${m.matched}/${m.total}`);

describe('date format detection', () => {
  it('finds ISO, UK, US and textual dates and ranks them by how many values each reads', async () => {
    const iso = await detect('iso');
    expect(iso.formats).toEqual(['%Y-%m-%d']);
    expect(top(iso, 1)).toEqual(['%Y-%m-%d 4/4']);

    const uk = await detect('uk');
    expect(uk.formats).toEqual(['%d/%m/%Y']);
    expect(top(uk)).toEqual(['%d/%m/%Y 4/4', '%m/%d/%Y 1/4']);

    const us = await detect('us');
    expect(us.formats).toEqual(['%m/%d/%Y']);
    expect(top(us)).toEqual(['%m/%d/%Y 4/4', '%d/%m/%Y 1/4']);

    const textual = await detect('textual');
    expect(textual.formats).toEqual(['%d %B %Y']);
  });

  it('ranks mixed columns by share, and uses every format they need, commonest first', async () => {
    const mixed = await detect('mixed');
    expect(mixed.formats).toEqual(['%Y-%m-%d', '%d/%m/%Y', '%d %B %Y']);
    expect(mixed.ranked[0]).toMatchObject({ matched: 2, total: 4 });
    expect(mixed.ranked.map((m) => m.format)).toEqual(expect.arrayContaining(['%d/%m/%Y', '%d %B %Y']));
  });

  it('never picks day or month first when both read every value', async () => {
    const d = await detect('ambiguous');
    expect(d.formats).toBeUndefined();
    expect(d.ambiguous).toEqual({
      dayFirst: '%d/%m/%Y',
      monthFirst: '%m/%d/%Y',
      example: expect.stringMatching(/^\d\d\/\d\d\/2024$/),
      covers: { day: ['%d/%m/%Y'], month: ['%m/%d/%Y'] },
    });
  });

  it('a project date format settles the order', async () => {
    const d = await detect('ambiguous', ['%m/%d/%Y']);
    expect(d.ambiguous).toBeUndefined();
    expect(d.formats?.[0]).toBe('%m/%d/%Y');
  });
});

describe('parse dates', () => {
  const parsed = async (params: Record<string, unknown>, column: string) => {
    const p = project([step('s', 'parseDates', params)]);
    const schema = await engine.describe(compile(p, { nodeId: 't' }).sql);
    const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId: 't' }, [column], 0))).table);
    return { type: schema.find((c) => c.name === column)?.type, values: rows.map((r) => r[column]) };
  };

  it('reads each value with the first format that fits, leaving the rest empty', async () => {
    const r = await parsed({ columns: ['mixed'], formats: ['%Y-%m-%d', '%d/%m/%Y'], onError: 'empty' }, 'mixed');
    expect(r).toEqual({ type: 'DATE', values: ['2024-01-31', '2024-01-31', null, '2024-12-25'] });
  });

  it('stops with the value when asked to fail', async () => {
    await expect(parsed({ columns: ['mixed'], formats: ['%Y-%m-%d'], onError: 'fail' }, 'mixed')).rejects.toThrow(/31\/01\/2024/);
  });

  it('keeps the time when the format has one', async () => {
    const r = await parsed({ columns: ['iso'], formats: ['%Y-%m-%d %H:%M:%S', '%Y-%m-%d'], onError: 'empty' }, 'iso');
    expect(r.type).toBe('TIMESTAMP');
  });
});

/** A fixture of `value` and the `expected` timestamp (empty where nothing should read it), loaded once. */
async function formatsFixture(file: string) {
  const source = src({ id: file.replace(/\W/g, '_'), format: 'csv' });
  await engine.registerBuffer(sourceFileName(source), new Uint8Array(readFileSync(join(__dirname, '../fixtures', file))));
  const p = (steps: ReturnType<typeof step>[] = []) =>
    flow({
      sources: [source],
      nodes: [
        { id: 'in', type: 'source', sourceId: source.id },
        { id: 't', type: 'transform', steps },
      ],
      wires: [['in', 't']],
    });
  const detection = await detectDateFormats(engine, p(), { nodeId: 't' }, 'value');
  const before = tableRows((await engine.query(`SELECT CAST(value AS VARCHAR) AS value, CAST(expected AS VARCHAR) AS expected FROM (${compile(p(), { nodeId: 't' }).sql})`)).table);
  const parsed = async (formats: string[]) => {
    const after = tableRows((await engine.query(`SELECT CAST(value AS VARCHAR) AS value FROM (${compile(p([step('s', 'parseDates', { columns: ['value'], formats })]), { nodeId: 't' }).sql})`)).table);
    return before.map((r, i) => [r.value, after[i]!.value ?? null]);
  };
  return { detection, parsed, expected: before.map((r) => [r.value, r.expected ?? null]) };
}

describe('every date format', () => {
  it('detects the formats a column of many kinds of dates needs, and reads each value as written', async () => {
    const { detection, parsed, expected } = await formatsFixture('date-formats.csv');
    // 24/01/2024 can only be day first, so 02/01/2024 is read that way too, saying why.
    expect(detection.ambiguous).toMatchObject({ order: 'day', byValues: '24/01/2024', example: '02/01/2024' });
    expect(detection.formats).not.toContain('%m/%d/%Y');
    expect(await parsed(detection.formats!)).toEqual(expected);
  });

  it('says which values no format reads', async () => {
    const { detection } = await formatsFixture('date-formats.csv');
    expect(unreadValues(detection, detection.formats!)).toEqual({ examples: ['not a date', '31/02/2024', '2024'], count: 3, total: 46 });
  });

  it('reads the month first when values settle it that way', async () => {
    const { detection, parsed, expected } = await formatsFixture('us-dates.csv');
    expect(detection.ambiguous).toMatchObject({ order: 'month', byValues: '01/24/2024' });
    expect(await parsed(detection.formats!)).toEqual(expected);
  });

  it('never reads a short year with %Y: 24/01/24 is not the year 24', async () => {
    const { parsed } = await formatsFixture('date-formats.csv');
    const rows = Object.fromEntries(await parsed(['%d/%m/%Y']));
    expect(rows['24/01/24']).toBeNull();
    expect(rows['24/01/2024']).toBe('2024-01-24');
  });
});
