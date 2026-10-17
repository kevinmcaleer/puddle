// Tables on a web page end to end below the UI: a local HTTP server, the real fetch, jsdom's HTML parser and real
// DuckDB-WASM (Node build), which types the table's text columns from the CSV Puddle hands it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error jsdom ships without type declarations, and only its DOMParser is used here.
import { JSDOM } from 'jsdom';
import { useEngineStore } from '../../src/app/engine';
import { compile, compileCount } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createProject, useProjectStore, type Project } from '../../src/model';
import { placeSources } from '../../src/runner/sources';
import { useAttachments } from '../../src/sources/attachments';
import { addWebTableSource, loadUrlSource, useUrlFetches } from '../../src/sources/url';
import { tablesAt } from '../../src/sources/webpage';
import { createNodeBackend } from '../helpers/nodeBackend';
import { startFileServer, type FileServer } from '../helpers/fileServer';

const BOND = readFileSync(join(__dirname, '../fixtures/bond-films.html'), 'utf8');

let engine: EngineClient;
let server: FileServer;
const hadParser = 'DOMParser' in globalThis;

beforeAll(async () => {
  // The browser's HTML parser; this file runs in Node beside the other engine tests.
  if (!hadParser) (globalThis as { DOMParser?: unknown }).DOMParser = (new JSDOM('') as { window: { DOMParser: unknown } }).window.DOMParser;
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
  server = await startFileServer({ cors: true });
  server.files.set('/bond', { body: BOND, type: 'text/html; charset=utf-8' });
});
afterAll(async () => {
  if (!hadParser) delete (globalThis as { DOMParser?: unknown }).DOMParser;
  await server.close();
  await engine.close();
});
beforeEach(() => {
  useProjectStore.getState().load(createProject('Web tables'));
  useAttachments.setState({ sources: {} });
  useUrlFetches.setState({ fetches: {} });
});

const project = () => useProjectStore.getState().history.present;
const nodeOf = (p: Project, sourceId: string) => p.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId)!.id;

async function addBond() {
  const { url, tables, route } = await tablesAt(server.url('/bond'));
  expect(route).toBe('direct');
  return addWebTableSource(url, tables.find((t) => t.label === 'Eon Productions films')!);
}

describe('a table on a web page as a source', () => {
  it('reads the Bond films with typed columns, named after the table', async () => {
    const s = await addBond();
    expect(s).toMatchObject({ kind: 'url', format: 'csv', name: 'Eon Productions films', url: { href: server.url('/bond'), table: { index: 1, label: 'Eon Productions films' } } });
    const p = project();
    const { sql } = compile(p, { nodeId: nodeOf(p, s.id) });
    const cols = await engine.describe(sql);
    expect(cols.map((c) => [c.name, c.type])).toEqual([
      ['Title', 'VARCHAR'],
      ['Year', 'BIGINT'],
      ['Bond actor', 'VARCHAR'],
      ['Director', 'VARCHAR'],
      ['Box office (US$ millions) Actual', 'DOUBLE'],
    ]);
    const rows = tableRows((await engine.query(`SELECT * FROM (${sql}) WHERE "Bond actor" = 'Sean Connery' ORDER BY "Year"`)).table) as { Title: string }[];
    expect(rows.map((r) => r.Title)).toEqual(['Dr. No', 'From Russia with Love', 'Goldfinger', 'Thunderball', 'You Only Live Twice', 'Diamonds Are Forever']);
  });

  it('fetches the page again on Refresh and notices when the table changed', async () => {
    const s = await addBond();
    server.files.set('/bond', { body: BOND.replace('>774.2</td>', '>775.0</td>'), type: 'text/html' });
    try {
      await loadUrlSource(project().sources[0]!, { refresh: true });
      expect(useAttachments.getState().sources[s.id]).toBe('mismatch');
      const p = project();
      const [{ n }] = tableRows((await engine.query(compileCount(p, { nodeId: nodeOf(p, s.id) }))).table) as [{ n: number }];
      expect(n).toBe(25);
    } finally {
      server.files.set('/bond', { body: BOND, type: 'text/html' });
    }
  });

  it('is one the runner says it can’t read yet, rather than reading the page as CSV', async () => {
    await addBond();
    expect(placeSources(project(), '/p', () => false)[0]).toMatchObject({ reason: 'is a table on a web page, which the runner can’t read yet' });
  });
});
