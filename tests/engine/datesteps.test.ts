// The Dates group past parsing, on real DuckDB-WASM (Node build): tests/fixtures/dates.csv, and periods.csv for
// timestamps, number amounts and empty values.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileDisplayPage, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import type { Source } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const dates = src({ id: 'dates', format: 'csv' });
const periods = src({ id: 'periods', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  for (const s of [dates, periods]) await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, `../fixtures/${s.id}.csv`))));
});
afterAll(() => engine.close());

async function run(source: Source, ...steps: Array<[type: string, params: Record<string, unknown>]>) {
  const p = flow({
    sources: [source],
    nodes: [
      { id: 'in', type: 'source', sourceId: source.id },
      { id: 't', type: 'transform', steps: steps.map(([type, params], i) => step(`s${i}`, type, params)) },
    ],
    wires: [['in', 't']],
  });
  const schema = await engine.describe(compile(p, { nodeId: 't' }).sql);
  const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId: 't' }, schema.map((c) => c.name), 0))).table);
  return { names: schema.map((c) => c.name), type: (name: string) => schema.find((c) => c.name === name)?.type, col: (name: string) => rows.map((r) => r[name]) };
}

describe('the fixtures', () => {
  it('read as dates and timestamps, with empty values', async () => {
    expect((await run(dates)).type('iso')).toBe('DATE');
    const r = await run(periods);
    expect([r.type('start'), r.type('stamp'), r.type('months')]).toEqual(['DATE', 'TIMESTAMP', 'BIGINT']);
    expect(r.col('start')[2]).toBeNull();
  });
});

describe('extract date part', () => {
  it('adds each part as a new column named after the date and the part', async () => {
    const part = async (p: string) => (await run(dates, ['extractDatePart', { columns: ['iso'], part: p, replace: false }])).col(`iso_${p.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`);
    expect(await part('year')).toEqual(['2024', '2024', '2024', '2024']);
    expect(await part('quarter')).toEqual(['1', '1', '1', '4']);
    expect(await part('month')).toEqual(['1', '2', '3', '12']);
    expect(await part('monthName')).toEqual(['January', 'February', 'March', 'December']);
    expect(await part('week')).toEqual(['5', '9', '9', '52']);
    expect(await part('day')).toEqual(['31', '29', '1', '25']);
    expect(await part('weekday')).toEqual(['3', '4', '5', '3']);
    expect(await part('weekdayName')).toEqual(['Wednesday', 'Thursday', 'Friday', 'Wednesday']);
  });

  it('replaces the date when asked, keeping empty values empty', async () => {
    const r = await run(periods, ['extractDatePart', { columns: ['stamp', 'start'], part: 'hour', replace: true }]);
    expect(r.names).toEqual(['id', 'start', 'finish', 'stamp', 'months', 'label']);
    expect(r.type('stamp')).toBe('BIGINT');
    expect(r.col('stamp')).toEqual(['9', '23', null, '12']);
    expect(r.col('start')).toEqual(['0', '0', null, '0']);
  });

  it('given text, says to parse the dates first', async () => {
    await expect(run(dates, ['extractDatePart', { columns: ['uk'], part: 'year', replace: false }])).rejects.toThrow(/text where dates or numbers are needed. Add a Parse dates/);
  });
});

describe('add or subtract time', () => {
  it('adds months, keeping dates as dates and landing on the last day of a shorter month', async () => {
    const r = await run(dates, ['shiftDates', { columns: ['iso'], direction: 'add', by: 'fixed', amount: 1, unit: 'months', keepTime: false }]);
    expect(r.type('iso')).toBe('DATE');
    expect(r.col('iso')).toEqual(['2024-02-29', '2024-03-29', '2024-04-01', '2025-01-25']);
  });

  it('subtracts weeks from timestamps, keeping the time', async () => {
    const r = await run(periods, ['shiftDates', { columns: ['stamp'], direction: 'subtract', by: 'fixed', amount: 2, unit: 'weeks', keepTime: true }]);
    expect(r.type('stamp')).toBe('TIMESTAMP');
    expect(r.col('stamp')).toEqual(['2024-01-17 09:15:00', '2024-03-03 23:59:59', null, '2024-12-17 12:00:00']);
  });

  it('takes each row’s amount from a number column; an empty amount or date gives an empty value', async () => {
    const r = await run(periods, ['shiftDates', { columns: ['start'], direction: 'add', by: 'column', amountColumn: 'months', unit: 'months', keepTime: false }]);
    expect(r.col('start')).toEqual(['2024-02-29', '2024-01-15', null, '2025-12-30']);
    const years = await run(periods, ['shiftDates', { columns: ['finish'], direction: 'subtract', by: 'column', amountColumn: 'months', unit: 'years', keepTime: false }]);
    expect(years.col('finish')).toEqual(['2023-02-28', '2025-12-25', null, '2013-01-01']);
  });

  it('adds hours to a date as a timestamp when the time is kept', async () => {
    const r = await run(dates, ['shiftDates', { columns: ['iso'], direction: 'add', by: 'fixed', amount: 36, unit: 'hours', keepTime: true }]);
    expect(r.type('iso')).toBe('TIMESTAMP');
    expect(r.col('iso')[0]).toBe('2024-02-01 12:00:00');
  });
});

describe('time between dates', () => {
  it('counts whole units, negative when the end is earlier, empty when either date is', async () => {
    const between = async (unit: string) => (await run(periods, ['dateDifference', { start: 'start', end: 'finish', unit, into: 'gap' }])).col('gap');
    expect(await between('days')).toEqual(['29', '-81', null, '2']);
    // 31 January to 29 February runs to the end of the month, so DuckDB counts it as a whole month.
    expect(await between('months')).toEqual(['1', '-2', null, '0']);
    expect(await between('years')).toEqual(['0', '0', null, '0']);
    const hours = await run(periods, ['dateDifference', { start: 'start', end: 'stamp', unit: 'hours', into: 'h' }]);
    expect(hours.col('h')).toEqual(['9', '71', null, '36']);
  });
});

describe('truncate dates', () => {
  it('keeps dates as dates, at the start of the month, quarter or Monday-first week', async () => {
    const to = async (unit: string) => run(dates, ['truncateDates', { columns: ['iso'], to: unit }]);
    const month = await to('month');
    expect(month.type('iso')).toBe('DATE');
    expect(month.col('iso')).toEqual(['2024-01-01', '2024-02-01', '2024-03-01', '2024-12-01']);
    expect((await to('quarter')).col('iso')).toEqual(['2024-01-01', '2024-01-01', '2024-01-01', '2024-10-01']);
    expect((await to('week')).col('iso')).toEqual(['2024-01-29', '2024-02-26', '2024-02-26', '2024-12-23']);
    expect((await to('year')).col('iso')).toEqual(['2024-01-01', '2024-01-01', '2024-01-01', '2024-01-01']);
  });

  it('truncates timestamps to the hour and leaves empty values empty', async () => {
    const r = await run(periods, ['truncateDates', { columns: ['stamp'], to: 'hour' }]);
    expect(r.col('stamp')).toEqual(['2024-01-31 09:00:00', '2024-03-17 23:00:00', null, '2024-12-31 12:00:00']);
    expect((await run(periods, ['truncateDates', { columns: ['stamp'], to: 'day' }])).col('stamp')).toEqual(['2024-01-31 00:00:00', '2024-03-17 00:00:00', null, '2024-12-31 00:00:00']);
  });
});

describe('format dates as text', () => {
  it('writes dates and timestamps with a strftime format; empty stays empty', async () => {
    const r = await run(dates, ['formatDates', { columns: ['iso'], format: '%A %-d %B %Y' }]);
    expect(r.type('iso')).toBe('VARCHAR');
    expect(r.col('iso')).toEqual(['Wednesday 31 January 2024', 'Thursday 29 February 2024', 'Friday 1 March 2024', 'Wednesday 25 December 2024']);
    expect((await run(periods, ['formatDates', { columns: ['stamp'], format: '%d/%m/%Y %H:%M' }])).col('stamp')).toEqual(['31/01/2024 09:15', '17/03/2024 23:59', null, '31/12/2024 12:00']);
  });

  it.each(['%d/%m/%Y', '%m-%d-%y', '%d %B %Y', '%Y%m%d'])('round-trips through parse dates with the same format: %s', async (format) => {
    const original = (await run(dates)).col('iso');
    const r = await run(dates, ['formatDates', { columns: ['iso'], format }], ['parseDates', { columns: ['iso'], formats: [format], onError: 'fail' }]);
    expect(r.type('iso')).toBe('DATE');
    expect(r.col('iso')).toEqual(original);
  });

  it('round-trips timestamps too', async () => {
    const original = (await run(periods)).col('stamp');
    const format = '%Y-%m-%d %H:%M:%S';
    const r = await run(periods, ['formatDates', { columns: ['stamp'], format }], ['parseDates', { columns: ['stamp'], formats: [format], onError: 'fail' }]);
    expect(r.col('stamp')).toEqual(original);
  });
});
