// Date format detection and parsing on real DuckDB-WASM (Node build) against tests/fixtures/dates.csv.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileDisplayPage, sourceFileName } from '../../src/compiler';
import { detectDateFormats } from '../../src/dates';
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
    expect(iso.best).toBe('%Y-%m-%d');
    expect(top(iso, 1)).toEqual(['%Y-%m-%d 4/4']);

    const uk = await detect('uk');
    expect(uk.best).toBe('%d/%m/%Y');
    expect(top(uk)).toEqual(['%d/%m/%Y 4/4', '%m/%d/%Y 1/4']);

    const us = await detect('us');
    expect(us.best).toBe('%m/%d/%Y');
    expect(top(us)).toEqual(['%m/%d/%Y 4/4', '%d/%m/%Y 1/4']);

    const textual = await detect('textual');
    expect(textual.best).toBe('%d %B %Y');
  });

  it('ranks mixed columns by share, so no single format looks complete', async () => {
    const mixed = await detect('mixed');
    expect(mixed.best).toBe('%Y-%m-%d');
    expect(mixed.ranked[0]).toMatchObject({ matched: 2, total: 4 });
    expect(mixed.ranked.map((m) => m.format)).toEqual(expect.arrayContaining(['%d/%m/%Y', '%d %B %Y']));
  });

  it('never picks day or month first when both read every value', async () => {
    const d = await detect('ambiguous');
    expect(d.best).toBeUndefined();
    expect(d.ambiguous).toEqual({ dayFirst: '%d/%m/%Y', monthFirst: '%m/%d/%Y', example: expect.stringMatching(/^\d\d\/\d\d\/2024$/) });
  });

  it('a project date format settles the order', async () => {
    const d = await detect('ambiguous', ['%m/%d/%Y']);
    expect(d.ambiguous).toBeUndefined();
    expect(d.best).toBe('%m/%d/%Y');
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
