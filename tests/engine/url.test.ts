// URL sources end to end below the UI: a local HTTP server, the real fetch, and real DuckDB-WASM (Node build).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEngineStore } from '../../src/app/engine';
import { compile, compileCount, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { addNode, createProject, useProjectStore, type Project } from '../../src/model';
import { attachProject } from '../../src/sources/attach';
import { useAttachments } from '../../src/sources/attachments';
import { addUrlSource, loadUrlSource, useUrlFetches } from '../../src/sources/url';
import { createNodeBackend } from '../helpers/nodeBackend';
import { startFileServer, type FileServer } from '../helpers/fileServer';

const fixture = (name: string) => readFileSync(join(__dirname, '../fixtures', name));

let engine: EngineClient;
let server: FileServer;
let ranged: FileServer;

beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
  server = await startFileServer({ cors: true });
  ranged = await startFileServer({ cors: true, ranges: true });
  for (const s of [server, ranged]) {
    s.files.set('/customers.csv', { body: fixture('customers.csv'), type: 'text/csv' });
    s.files.set('/export', { body: fixture('orders.tsv'), type: 'text/tab-separated-values; charset=utf-8' });
    s.files.set('/customers.parquet', { body: fixture('customers.parquet'), type: 'application/octet-stream' });
  }
});
afterAll(async () => {
  await Promise.all([server.close(), ranged.close()]);
  await engine.close();
});
beforeEach(() => {
  useProjectStore.getState().load(createProject('URLs'));
  useAttachments.setState({ sources: {} });
  useUrlFetches.setState({ fetches: {} });
  server.requests.length = 0;
  ranged.requests.length = 0;
});

const project = () => useProjectStore.getState().history.present;
const sourceNode = (p: Project, sourceId: string) => p.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId)!.id;
const count = async (sourceId: string) => {
  const p = project();
  const [{ n }] = tableRows((await engine.query(compileCount(p, { nodeId: sourceNode(p, sourceId) }))).table) as [{ n: number }];
  return n;
};

describe('URL sources', () => {
  it('adds a CSV from an address, fetched once and read by DuckDB', async () => {
    const s = await addUrlSource(server.url('/customers.csv'));
    expect(s).toMatchObject({ kind: 'url', name: 'customers.csv', format: 'csv', url: { href: server.url('/customers.csv'), size: fixture('customers.csv').length } });
    expect(s.url!.headHash).toMatch(/^[0-9a-f]{64}$/);
    expect(useAttachments.getState().sources[s.id]).toBe('attached');
    expect(useUrlFetches.getState().fetches[s.id]).toMatchObject({ state: 'ok', ranged: false });
    expect(await count(s.id)).toBe(4);
    expect(server.requests).toHaveLength(1);
  });

  it('reads the format from the Content-Type when the address has no extension', async () => {
    const s = await addUrlSource(ranged.url('/export'));
    expect(s.format).toBe('tsv');
    const p = project();
    const cols = await engine.describe(compile(p, { nodeId: sourceNode(p, s.id) }).sql);
    expect(cols.map((c) => c.name)).toEqual(['order_id', 'customer_id', 'total']);
  });

  it('registers Parquet by address when the server supports range requests, and fetches it otherwise', async () => {
    const r = await addUrlSource(ranged.url('/customers.parquet'));
    expect(useUrlFetches.getState().fetches[r.id]).toMatchObject({ state: 'ok', ranged: true });
    // Only the first megabyte was fetched here; DuckDB reads the rest itself.
    expect(ranged.requests.filter((q) => q.path === '/customers.parquet').map((q) => q.range)).toEqual(['bytes=0-1048575', undefined]);
    const whole = await addUrlSource(server.url('/customers.parquet'));
    expect(useUrlFetches.getState().fetches[whole.id]).toMatchObject({ state: 'ok', ranged: false });
    expect(sourceFileName(whole)).toMatch(/\.parquet$/);
  });

  it('re-fetches on reopening with no re-attach step, and notices a changed file', async () => {
    const s = await addUrlSource(server.url('/customers.csv'));
    const saved = project();
    // A new tab: nothing fetched yet.
    useUrlFetches.setState({ fetches: {} });
    useAttachments.setState({ sources: {} });
    server.files.set('/customers.csv', { body: fixture('customers.csv').toString() + '5,Grace Hopper,grace@example.org,2026-02-01\n', type: 'text/csv' });
    try {
      await attachProject(saved);
      expect(useUrlFetches.getState().fetches[s.id]?.state).toBe('fetching');
      await loadUrlSource(s); // joins the fetch already running
      expect(useAttachments.getState().sources[s.id]).toBe('mismatch');
      expect(project().sources[0]!.url!.headHash).not.toBe(s.url!.headHash);
      expect(await count(s.id)).toBe(5);
      // Refreshing again with nothing changed clears the warning.
      await loadUrlSource(project().sources[0]!, { refresh: true });
      expect(useAttachments.getState().sources[s.id]).toBe('attached');
    } finally {
      server.files.set('/customers.csv', { body: fixture('customers.csv'), type: 'text/csv' });
    }
  });

  it('keeps a source fetched in this tab attached when its project is shown again', async () => {
    const s = await addUrlSource(server.url('/customers.csv'));
    server.requests.length = 0;
    await attachProject(project());
    expect(useAttachments.getState().sources[s.id]).toBe('attached');
    expect(server.requests).toHaveLength(0);
  });

  it('marks a source that can’t be fetched any more, and says why', async () => {
    const s = await addUrlSource(server.url('/customers.csv'));
    const gone = { ...s, url: { href: server.url('/moved.csv') } };
    useProjectStore.getState().apply((p) => addNode({ ...p, sources: [gone] }, 'output', { x: 0, y: 0 }));
    await loadUrlSource(gone);
    expect(useAttachments.getState().sources[s.id]).toBe('detached');
    expect(useUrlFetches.getState().fetches[s.id]).toMatchObject({ state: 'failed', kind: 'status', message: expect.stringContaining('no file at this address') });
  });

  it('refuses a plain http address before fetching anything', async () => {
    await expect(addUrlSource('http://example.org/customers.csv')).rejects.toMatchObject({ kind: 'address', message: expect.stringContaining('mixed content') });
    expect(project().sources).toHaveLength(0);
  });
});
