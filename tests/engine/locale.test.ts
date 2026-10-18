// Parse numbers and parse dates with a locale, on real DuckDB-WASM (Node build) against tests/fixtures/locales.csv
// and the ambiguous column of tests/fixtures/dates.csv.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileDisplayPage, sourceFileName } from '../../src/compiler';
import { detectDateFormats } from '../../src/dates';
import { EngineClient, tableRows } from '../../src/engine/client';
import type { Project } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const locales = src({ id: 'locales', format: 'csv' });
const dates = src({ id: 'dates', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  for (const [s, file] of [
    [locales, 'locales.csv'],
    [dates, 'dates.csv'],
  ] as const)
    await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, '../fixtures', file))));
});
afterAll(() => engine.close());

const project = (source: typeof locales, steps: ReturnType<typeof step>[] = []): Project =>
  flow({
    sources: [source],
    nodes: [
      { id: 'in', type: 'source', sourceId: source.id },
      { id: 't', type: 'transform', steps },
    ],
    wires: [['in', 't']],
  });

async function run(type: string, params: Record<string, unknown>, column: string, source = locales) {
  const p = project(source, [step('s', type, params)]);
  const schema = await engine.describe(compile(p, { nodeId: 't' }).sql);
  const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId: 't' }, [column], 0))).table);
  return { type: schema.find((c) => c.name === column)?.type, values: rows.map((r) => r[column]) };
}

describe('parse numbers with a locale', () => {
  it('reads 1.234,56 as 1234.56 with a German locale, whatever the decimal setting says', async () => {
    const r = await run('parseNumbers', { columns: ['de_number'], decimal: '.', locale: 'de-DE' }, 'de_number');
    expect(r).toEqual({ type: 'DOUBLE', values: ['1234.56', '-7.5', '-12.0'] });
  });

  it('reads 1,234.56 as 1234.56 with a US locale', async () => {
    expect((await run('parseNumbers', { columns: ['us_number'], decimal: ',', locale: 'en-US' }, 'us_number')).values).toEqual(['1234.56', '-7.5', '-12.0']);
  });

  it('keeps reading a step without a locale by its decimal mark, as before', async () => {
    expect((await run('parseNumbers', { columns: ['de_number'], decimal: ',' }, 'de_number')).values).toEqual(['1234.56', '-7.5', '-12.0']);
    expect((await run('parseNumbers', { columns: ['de_number'], decimal: '.' }, 'de_number')).values).toEqual(['1.23456', '-75.0', '-1200.0']);
  });
});

describe('parse dates with a locale', () => {
  it('reads German month names, abbreviated or not and in any case', async () => {
    expect(await run('parseDates', { columns: ['de_date'], formats: ['%d. %B %Y'], locale: 'de-DE' }, 'de_date')).toEqual({ type: 'DATE', values: ['2026-12-31', '2026-03-01', '2026-10-15'] });
    expect((await run('parseDates', { columns: ['de_short'], formats: ['%d. %b %Y'], locale: 'de-DE' }, 'de_short')).values).toEqual(['2026-10-15', '2026-03-03', '2026-12-24']);
  });

  it('reads French and Spanish month names, and the French first of the month', async () => {
    expect((await run('parseDates', { columns: ['fr_date'], formats: ['%d %B %Y'], locale: 'fr-FR' }, 'fr_date')).values).toEqual(['2026-01-01', '2026-07-14', '2026-12-25']);
    expect((await run('parseDates', { columns: ['es_date'], formats: ['%d de %B de %Y'], locale: 'es-ES' }, 'es_date')).values).toEqual(['2026-12-31', '2026-03-01', '2026-08-09']);
  });

  it('reads names in English only without a locale, as before', async () => {
    expect((await run('parseDates', { columns: ['de_date'], formats: ['%d. %B %Y'] }, 'de_date')).values).toEqual([null, null, null]);
  });

  it('follows the locale for dates that read either way', async () => {
    const uk = await run('parseDates', { columns: ['ambiguous'], formats: ['%d/%m/%Y'], locale: 'en-GB' }, 'ambiguous', dates);
    const us = await run('parseDates', { columns: ['ambiguous'], formats: ['%m/%d/%Y'], locale: 'en-US' }, 'ambiguous', dates);
    expect(uk.values[1]).toBe('2024-04-03');
    expect(us.values[1]).toBe('2024-03-04');
  });
});

describe('date detection with a locale', () => {
  const detect = (column: string, locale?: string, source = locales) => detectDateFormats(engine, project(source), { nodeId: 't' }, column, locale);

  it('finds formats with the locale’s month names, showing the values as written', async () => {
    const de = await detect('de_date', 'de-DE');
    expect(de.formats?.[0]).toBe('%d. %B %Y');
    expect(de.ranked[0]).toMatchObject({ matched: 3, total: 3 });
    expect(de.ranked[0]!.example).toMatch(/Dezember|MÄRZ|Oktober/);
    expect((await detect('es_date', 'es-ES')).formats?.[0]).toBe('%d de %B de %Y');
    expect((await detect('de_date')).formats).toBeUndefined();
  });

  it('settles an unclear day and month order by the locale, and says so', async () => {
    const uk = await detect('ambiguous', 'en-GB', dates);
    expect(uk.formats?.[0]).toBe('%d/%m/%Y');
    expect(uk.ambiguous).toMatchObject({ dayFirst: '%d/%m/%Y', monthFirst: '%m/%d/%Y', byLocale: 'en-GB' });
    expect((await detect('ambiguous', 'en-US', dates)).formats?.[0]).toBe('%m/%d/%Y');
    expect((await detect('ambiguous', 'de-DE', dates)).formats?.[0]).toBe('%d/%m/%Y');
  });
});
