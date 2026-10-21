// puddle-connect in process: started on a free port, called over HTTP as the browser would. The SQLite fixture is
// read through /read as an Arrow stream, a read is cancelled, and the refusals hold: no token, a host off the
// allowlist, a file outside the folders it may read, a statement that writes, a driver it hasn't got.
import { tableFromIPC } from 'apache-arrow';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, parseArgs, parseRequest, targetHost, USAGE, type ServerOptions } from '../../src/connect/server';
import type { Connector } from '../../src/connect/types';

const fixtures = join(__dirname, '../fixtures/db');
const shop = join(fixtures, 'shop.sqlite');

const quiet = () => undefined;

function start(partial: Partial<ServerOptions> = {}, connectors?: Record<string, Connector>) {
  const options: ServerOptions = { host: '127.0.0.1', port: 0, origins: ['http://localhost:4173'], allow: [], files: [fixtures], timeoutMs: 5000, rowCap: 1_000_000, concurrent: 2, log: quiet, ...partial };
  const server = createServer(options, connectors as never);
  const base = new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  return { server, base };
}

const post = (base: string, route: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('puddle-connect', () => {
  let base: string;
  let server: ReturnType<typeof start>['server'];
  beforeAll(async () => {
    const s = start();
    server = s.server;
    base = await s.base;
  });
  afterAll(() => server.close());

  it('says what it is and answers CORS for its origins only', async () => {
    const r = await fetch(`${base}/health`, { headers: { Origin: 'http://localhost:4173' } });
    expect(await r.json()).toEqual({ version: expect.any(String), drivers: ['sqlite', 'libsql', 'postgres', 'redshift', 'cockroach', 'greengage', 'mysql', 'mariadb', 'tidb', 'firebird', 'sqlserver', 'oracle', 'clickhouse', 'bigquery', 'snowflake', 'trino'], allowlist: false });
    expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:4173');
    const other = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await fetch(`${base}/read`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:4173' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-expose-headers')).toContain('Puddle-Read-Id');
  });

  it('tests, catalogues, documents and reads a SQLite file by its path, as an Arrow stream with its columns in headers', async () => {
    const body = { driver: 'sqlite', settings: { path: shop } };
    expect(await (await post(base, 'test', body)).json()).toEqual({ ok: true, server: 'SQLite file, 3 tables' });
    const catalog = (await (await post(base, 'catalog', body)).json()) as { tables: { name: string }[] };
    expect(catalog.tables.map((t) => t.name)).toEqual(['customers', 'orders', 'order_totals']);
    const detail = (await (await post(base, 'document', body)).json()) as { tables: { name: string; foreignKeys: unknown[] }[] };
    expect(detail.tables[1]!.foreignKeys).toHaveLength(1);
    const r = await post(base, 'read', { ...body, table: { name: 'orders' }, limit: 2 });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/vnd.apache.arrow.stream');
    expect(r.headers.get('puddle-rows')).toBe('2');
    expect(r.headers.get('puddle-read-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(r.headers.get('puddle-columns')!).map((c: { name: string }) => c.name)).toEqual(['id', 'customer_id', 'total', 'placed_at']);
    const table = tableFromIPC(new Uint8Array(await r.arrayBuffer()));
    expect(table.numRows).toBe(2);
    expect(Array.from(table.getChild('id')!.toArray(), Number)).toEqual([101, 102]);
    const q = await post(base, 'read', { ...body, query: 'SELECT count(*) AS n FROM customers' });
    expect(q.status).toBe(200);
    expect(Number(tableFromIPC(new Uint8Array(await q.arrayBuffer())).getChild('n')!.get(0))).toBe(3);
  });

  it('refuses a file outside its folders, a statement that writes, a driver it hasn’t got, a bad body, and a route it doesn’t have', async () => {
    const outside = await post(base, 'catalog', { driver: 'sqlite', settings: { path: '/etc/hosts' } });
    expect(outside.status).toBe(422);
    expect(await outside.text()).toMatch(/outside the folders/);
    const dots = await post(base, 'catalog', { driver: 'sqlite', settings: { path: join(fixtures, '..', '..', 'package.json') } });
    expect(dots.status).toBe(422);
    const write = await post(base, 'read', { driver: 'sqlite', settings: { path: shop }, query: 'DELETE FROM customers' });
    expect(write.status).toBe(400);
    expect(await write.text()).toMatch(/not DELETE/);
    const two = await post(base, 'read', { driver: 'sqlite', settings: { path: shop }, query: 'SELECT 1; SELECT 2' });
    expect(two.status).toBe(400);
    const none = await post(base, 'test', { driver: 'sqlanywhere', settings: { host: 'db.local' } });
    expect(none.status).toBe(501);
    expect((await post(base, 'test', {})).status).toBe(400);
    expect((await fetch(`${base}/test`, { method: 'POST', body: '{not json' })).status).toBe(400);
    expect((await post(base, 'fetch', { url: 'http://169.254.169.254/' })).status).toBe(404);
    expect((await fetch(`${base}/test`)).status).toBe(405);
  });

  it('caps how many reads run at once, and says when a cancel names no read', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: Connector = {
      id: 'sqlite',
      runsIn: ['local'],
      test: async () => ({ ok: true, server: 'slow' }),
      catalog: async () => ({ tables: [] }),
      read: async () => {
        await gate;
        return { ipc: new Uint8Array(8), columns: [], rows: 0 };
      },
    };
    const s = start({ concurrent: 1 }, { sqlite: slow });
    const b = await s.base;
    try {
      const first = post(b, 'read', { driver: 'sqlite', settings: {}, table: { name: 't' } }).then((r) => r.status);
      await new Promise((r) => setTimeout(r, 50));
      // A second read while the first runs is refused, not queued.
      const second = await post(b, 'read', { driver: 'sqlite', settings: {}, table: { name: 't' } });
      expect(second.status).toBe(503);
      release();
      expect(await first).toBe(200);
      expect(await (await post(b, 'cancel', { id: 'nothing' })).json()).toEqual({ cancelled: false });
    } finally {
      s.server.close();
    }
  });

  it('cancels a read it named, and times one out', async () => {
    let seen: AbortSignal | undefined;
    const never: Connector = {
      id: 'sqlite',
      runsIn: ['local'],
      test: async () => ({ ok: true, server: '' }),
      catalog: async () => ({ tables: [] }),
      read: (ctx) => {
        seen = ctx.signal;
        return new Promise(() => undefined);
      },
    };
    const s = start({ timeoutMs: 150 }, { sqlite: never });
    const b = await s.base;
    try {
      const r = await post(b, 'read', { driver: 'sqlite', settings: {}, table: { name: 't' } });
      expect(r.status).toBe(499);
      expect(seen?.aborted).toBe(true);
      // Dropping the request cancels the read too.
      const controller = new AbortController();
      const dropped = fetch(`${b}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driver: 'sqlite', settings: {}, table: { name: 't' } }), signal: controller.signal }).catch(() => 'dropped');
      await new Promise((r) => setTimeout(r, 30));
      controller.abort();
      expect(await dropped).toBe('dropped');
      await expect.poll(() => seen?.aborted, { timeout: 2000 }).toBe(true);
    } finally {
      s.server.close();
    }
  });
});

describe('with a token and an allowlist', () => {
  it('answers 401 without the token, before reading the body, and 403 for a host off the list', async () => {
    const s = start({ token: 'hunter2', allow: [{ kind: 'host', name: 'db.local' }] });
    const b = await s.base;
    try {
      expect((await fetch(`${b}/health`)).status).toBe(401);
      expect((await fetch(`${b}/health`, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
      const ok = await fetch(`${b}/health`, { headers: { Authorization: 'Bearer hunter2' } });
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { allowlist: boolean }).allowlist).toBe(true);
      const off = await post(b, 'test', { driver: 'postgres', settings: { host: 'other.local' } }, { Authorization: 'Bearer hunter2' });
      expect(off.status).toBe(403);
      expect(await off.text()).toMatch(/allowlist/);
      // On the list, the request reaches the driver, which wants the rest of its settings.
      const on = await post(b, 'test', { driver: 'postgres', settings: { host: 'db.local' } }, { Authorization: 'Bearer hunter2' });
      expect(on.status).toBe(422);
      expect(await on.text()).toMatch(/database name/);
      // Loopback is not implied by a list.
      expect((await post(b, 'test', { driver: 'postgres', settings: { host: '127.0.0.1' } }, { Authorization: 'Bearer hunter2' })).status).toBe(403);
    } finally {
      s.server.close();
    }
  });
});

describe('the command line', () => {
  it('binds to loopback with no token, adds the development origins, and reads files from the current folder', () => {
    const { options, error } = parseArgs(['--origin', 'https://puddle.example'], {});
    expect(error).toBeUndefined();
    expect(options).toMatchObject({ host: '127.0.0.1', port: 8765, token: undefined, allow: [], files: [process.cwd()] });
    expect(options!.origins).toEqual(['https://puddle.example', 'http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173', 'http://127.0.0.1:4173']);
  });

  it('refuses to listen beyond this computer without a token, and reads the allowlist and folders from the environment', () => {
    expect(parseArgs(['--host', '0.0.0.0'], {}).error).toMatch(/PUDDLE_CONNECT_TOKEN/);
    const { options, error } = parseArgs(['--host', '0.0.0.0', '--allow', '10.0.0.0/8'], { PUDDLE_CONNECT_TOKEN: 't', PUDDLE_CONNECT_ALLOW: 'db.local', PUDDLE_CONNECT_FILES: '/data', PUDDLE_CONNECT_TIMEOUT: '5' });
    expect(error).toBeUndefined();
    expect(options).toMatchObject({ host: '0.0.0.0', token: 't', files: ['/data'], timeoutMs: 5000 });
    expect(options!.allow).toHaveLength(2);
    expect(options!.origins).toEqual([]);
    expect(parseArgs(['--token', 'x'], {}).error).toMatch(/not on the command line/);
    expect(parseArgs(['--allow', 'bad host!'], {}).error).toMatch(/PUDDLE_CONNECT_ALLOW/);
    expect(parseArgs(['--port', 'abc'], {}).error).toMatch(/port/);
    expect(parseArgs(['--what'], {}).error).toMatch(/Unknown option/);
    expect(parseArgs(['--help'], {}).error).toBe(USAGE);
  });

  it('reads a request without taking anything but the driver, settings, secret and read; the connection has no name to leak', () => {
    const parsed = parseRequest({ driver: 'postgres', settings: { host: 'db', port: 5432, ssl: true, nested: { x: 1 } }, secret: 'hunter2', table: { schema: 'public', name: 'orders' }, limit: 10.7, name: 'Shop', catalog: { tables: [] } });
    expect(parsed).toEqual({ connection: { id: 'request', name: '', driver: 'postgres', via: 'local', settings: { host: 'db', port: 5432, ssl: true }, auth: 'none' }, secret: 'hunter2', read: { table: { schema: 'public', name: 'orders' }, limit: 10 } });
    expect(JSON.stringify(parsed.connection)).not.toContain('Shop');
    expect(targetHost({ host: 'db.local' })).toBe('db.local');
    expect(targetHost({ url: 'https://ch.example:8443/x' })).toBe('ch.example');
    expect(targetHost({ url: 'not a url' })).toBe('not a url');
    expect(targetHost({ path: '/x' })).toBeUndefined();
    // The warehouses reach their own hosts unless an address is given, so the allowlist still applies to them.
    expect(targetHost({ project: 'p' }, 'bigquery')).toBe('bigquery.googleapis.com');
    expect(targetHost({ project: 'p', endpoint: 'http://127.0.0.1:18090' }, 'bigquery')).toBe('127.0.0.1');
    expect(targetHost({ account: 'xy12345.eu-west-2' }, 'snowflake')).toBe('xy12345.eu-west-2.snowflakecomputing.com');
    expect(targetHost({ account: 'xy12345', url: 'https://xy12345.privatelink.snowflakecomputing.com' }, 'snowflake')).toBe('xy12345.privatelink.snowflakecomputing.com');
  });
});
