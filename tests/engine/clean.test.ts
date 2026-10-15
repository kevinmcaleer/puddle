// Quick-fix steps on real DuckDB-WASM (Node build) against tests/fixtures/messy.csv.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileDisplayPage, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const messy = src({ id: 'messy', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(messy), new Uint8Array(readFileSync(join(__dirname, '../fixtures/messy.csv'))));
});
afterAll(() => engine.close());

async function run(type: string, params: Record<string, unknown>) {
  const p = flow({
    sources: [messy],
    nodes: [
      { id: 'in', type: 'source', sourceId: messy.id },
      { id: 't', type: 'transform', steps: [step('s', type, params)] },
    ],
    wires: [['in', 't']],
  });
  const schema = await engine.describe(compile(p, { nodeId: 't' }).sql);
  const rows = tableRows((await engine.query(compileDisplayPage(p, { nodeId: 't' }, schema.map((c) => c.name), 0))).table);
  return { types: Object.fromEntries(schema.map((c) => [c.name, c.type])), col: (name: string) => rows.map((r) => r[name]) };
}

describe('clean steps', () => {
  it('collapses runs of spaces inside values, leaving the ends for trim', async () => {
    expect((await run('collapseSpaces', { columns: ['name'] })).col('name')).toEqual([' ada lovelace ', 'grace hopper', 'edsger​dijkstra', ' ', 'edsger​dijkstra']);
  });

  it('removes zero-width and control characters', async () => {
    expect((await run('removeNonPrinting', { columns: ['name'] })).col('name')[2]).toBe('edsgerdijkstra');
  });

  it('turns empty and blank text into empty values, keeping the type', async () => {
    const r = await run('emptyToNull', { columns: ['name', 'id'] });
    expect(r.col('name')[3]).toBeNull();
    expect(r.types.id).toBe('BIGINT');
  });

  it('parses numbers with currency, thousands separators and accounting negatives', async () => {
    const point = await run('parseNumbers', { columns: ['price'], decimal: '.' });
    expect(point.types.price).toBe('DOUBLE');
    expect(point.col('price')).toEqual(['1234.5', '99.0', '-12.0', '75.0', '-12.0']);
    const comma = await run('parseNumbers', { columns: ['price'], decimal: ',' });
    expect(comma.col('price')[3]).toBe('7.5');
  });
});
