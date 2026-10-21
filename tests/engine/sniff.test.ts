// The options the sniff chooses read the file on real DuckDB-WASM: a latin-1 SAP list keeps its umlauts, a UTF-16
// CSV reads, and a UTF-8 BOM never reaches the first column name.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, sourceFileName } from '../../src/compiler';
import { EngineClient } from '../../src/engine/client';
import { tableRows } from '../../src/engine';
import { sniff } from '../../src/sources/sniff';
import { decodeText, isRewrittenText, readText, rewrittenCsv } from '../../src/sources/text';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...new TextEncoder().encode(p)] : p)));
const utf16le = (text: string) => bytes([0xff, 0xfe], Array.from(text).flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]));

/** Sniff the bytes as `name`, register them and read the source with the options the sniff chose. */
async function read(name: string, data: Uint8Array) {
  const sniffed = sniff({ name, head: data.subarray(0, 1024 * 1024), size: data.length });
  const source = src({ id: `s_${name.replace(/\W/g, '_')}`, format: sniffed.format, parseOptions: sniffed.parseOptions });
  if (isRewrittenText(source)) await engine.registerText(sourceFileName(source), rewrittenCsv(readText(source.format, decodeText(data, source.parseOptions.encoding), source.parseOptions)));
  else await engine.registerBuffer(sourceFileName(source), data);
  const project = flow({ sources: [source], nodes: [{ id: 'in', type: 'source', sourceId: source.id }] });
  const columns = await engine.describe(`SELECT * FROM (${compile(project, { nodeId: 'in' }).sql}) LIMIT 0`);
  const rows = tableRows((await engine.query(compile(project, { nodeId: 'in' }).sql)).table);
  return { sniffed, columns: columns.map((c) => c.name), rows };
}

describe('reading with the sniffed options', () => {
  it('reads the SAP extract’s rows as latin-1 pipes, umlauts intact', async () => {
    const text = readFileSync(join(__dirname, '../fixtures/messy/sap-extract.txt'), 'latin1');
    const lines = text.split('\r\n');
    const table = [lines[5]!, ...lines.filter((l) => l.startsWith('|') && !l.startsWith('|Doc. no.') && !l.startsWith('|*'))].join('\r\n') + '\r\n';
    // The banner and footer lines come off in #185; here the table itself, written back as the latin-1 bytes it is.
    const data = bytes(Array.from(table, (c) => c.charCodeAt(0)));
    const { sniffed, columns, rows } = await read('sap-extract.txt', data);
    expect(sniffed).toMatchObject({ format: 'pipes', parseOptions: { encoding: 'latin-1' } });
    expect(columns.slice(0, 3)).toEqual(['Doc. no.', 'Vendor', 'Doc. date']);
    expect(rows).toHaveLength(60);
    expect(rows.map((r) => String(r['Vendor']).trim())).toContain('Müller GmbH');
  });

  it('reads a UTF-16 CSV, and leaves a UTF-8 BOM out of the first column name', async () => {
    const wide = await read('wide.csv', utf16le('name,city\nAda,Leeds\nBob,York\n'));
    expect(wide.sniffed.parseOptions).toEqual({ encoding: 'utf-16' });
    expect(wide.columns).toEqual(['name', 'city']);
    expect(wide.rows).toEqual([{ name: 'Ada', city: 'Leeds' }, { name: 'Bob', city: 'York' }]);

    const bom = await read('bom.csv', bytes([0xef, 0xbb, 0xbf], 'name;city\nAda;Leeds\n'));
    expect(bom.sniffed.parseOptions).toEqual({ delimiter: ';' });
    expect(bom.columns).toEqual(['name', 'city']);
  });

  it('reads JSON named .csv as JSON, the content having the final say (D24)', async () => {
    const data = new Uint8Array(readFileSync(join(__dirname, '../fixtures/sniff/items.csv')));
    const sniffed = sniff({ name: 'items.csv', head: data, size: data.length });
    expect(sniffed).toMatchObject({ format: 'json', confidence: 'sure', alternatives: ['csv'] });
    const source = src({ id: 'items_csv', format: sniffed.format, parseOptions: sniffed.parseOptions });
    await engine.registerBuffer(sourceFileName(source), data);
    const project = flow({ sources: [source], nodes: [{ id: 'in', type: 'source', sourceId: source.id }] });
    const { sql } = compile(project, { nodeId: 'in' });
    expect(sql).toContain('read_json_auto(');
    // The test build has no json extension (tests/helpers/nodeBackend.ts), so the read gets as far as asking for it;
    // the container e2e reads JSON for real.
    await expect(engine.query(sql)).rejects.toMatchObject({ code: 'missing-extension', message: expect.stringContaining('json extension') });
  });

  it('reads the CRM export’s table with the semicolons it found (its comment lines and footer come off in #185)', async () => {
    const lines = readFileSync(join(__dirname, '../fixtures/messy/messy.txt'), 'utf8').split(/\r?\n/);
    const { sniffed, columns, rows } = await read('messy.txt', bytes(lines.slice(2, -4).join('\n') + '\n'));
    expect(sniffed).toMatchObject({ format: 'csv', parseOptions: { delimiter: ';' } });
    expect(columns[0]).toBe('Customer ID');
    expect(rows.length).toBeGreaterThan(30);
  });
});
