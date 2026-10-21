// The ClickHouse driver against a real server, when PUDDLE_TEST_CLICKHOUSE names one (a URL such as
// http://default:puddle@localhost:8123/shop, seeded with scripts/seed-clickhouse.mjs). CI runs it against the
// ClickHouse container, locally scripts/clickhouse-stand-in.py serves; without the variable it is skipped.
import { tableFromIPC } from 'apache-arrow';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clickhouseConnector } from '../../src/connect/drivers/clickhouse';
import { createServer, type ServerOptions } from '../../src/connect/server';
import type { Connection } from '../../src/model';

const url = process.env.PUDDLE_TEST_CLICKHOUSE;

describe.skipIf(!url)(`the clickhouse driver against ${url ? new URL(url).host : 'no server'}`, () => {
  const u = new URL(url ?? 'http://x@localhost/x');
  const settings = { url: u.origin, database: u.pathname.slice(1), user: decodeURIComponent(u.username) || 'default' };
  const secret = decodeURIComponent(u.password);
  const connection: Connection = { id: 'c', name: 'shop', driver: 'clickhouse', via: 'local', settings, auth: 'password' };
  const ctx = { connection, secret };
  const connector = clickhouseConnector();

  it('connects and names the server', async () => {
    const t = await connector.test(ctx);
    expect(t).toMatchObject({ ok: true });
    expect(t.ok && t.server).toMatch(/^ClickHouse \d.*3 tables$/);
  });

  it('lists the shop’s tables with their types and row counts', async () => {
    const c = await connector.catalog(ctx);
    expect(c.tables.map((t) => [t.name, t.kind]).sort()).toEqual([
      ['customers', 'table'],
      ['order_totals', 'view'],
      ['orders', 'table'],
    ]);
    const orders = c.tables.find((t) => t.name === 'orders')!;
    expect(orders.rows).toBe(4);
    expect(orders.columns.find((x) => x.name === 'total')!.type).toBe('DECIMAL(10,2)');
    expect(orders.columns.find((x) => x.name === 'placed_at')!.type).toBe('TIMESTAMP');
    expect(orders.columns.find((x) => x.name === 'tags')!.type).toBe('JSON');
    expect(orders.columns.find((x) => x.name === 'notes')!.nullable).toBe(true);
    expect(c.tables.find((t) => t.name === 'customers')!.columns.find((x) => x.name === 'active')!.type).toBe('BOOLEAN');
  });

  it('documents the sorting key, comments, defaults, the skipping index and the view', async () => {
    const d = await connector.document!(ctx);
    const customers = d.tables.find((t) => t.name === 'customers')!;
    const orders = d.tables.find((t) => t.name === 'orders')!;
    expect(customers.note).toBe('People who have ordered');
    expect(customers.columns.find((c) => c.name === 'id')).toMatchObject({ pk: true, notNull: true });
    expect(customers.columns.find((c) => c.name === 'email')).toMatchObject({ type: 'Nullable(String)', notNull: false, note: 'Lower case' });
    expect(orders.columns.find((c) => c.name === 'status')).toMatchObject({ type: 'LowCardinality(String)', default: "'placed'" });
    expect(orders.indexes).toEqual([{ name: 'orders_status', columns: ['status'], unique: false }]);
    expect(d.tables.find((t) => t.name === 'order_totals')!.sql).toMatch(/customers/i);
  });

  it('reads a table and a query with their values converted, and refuses to write', async () => {
    const r = await connector.read(ctx, { table: { name: 'orders' } });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('total')!.toArray().map(Number)).toEqual([19.99, 5.5, 120, 42.25]);
    expect(t.getChild('tags')!.get(0)).toBe('["gift","express"]');
    const q = await connector.read(ctx, { query: 'SELECT name, signed_up, active FROM customers ORDER BY id', limit: 2 });
    if (!('ipc' in q)) throw new Error('expected a stream');
    expect(q.rows).toBe(2);
    expect(q.columns.map((c) => c.sqlType)).toEqual(['VARCHAR', 'DATE', 'BOOLEAN']);
    await expect(connector.read(ctx, { query: "ALTER TABLE customers UPDATE name = 'x' WHERE id = 1" })).rejects.toThrow(/read-only|answered/);
  });

  it('answers a browser’s request with the CORS header, so the page needs no service', async () => {
    const target = new URL(`${settings.url}/`);
    target.searchParams.set('user', settings.user);
    target.searchParams.set('password', secret);
    target.searchParams.set('add_http_cors_header', '1');
    const res = await fetch(target, { method: 'POST', body: 'SELECT 1', headers: { Origin: 'http://localhost:5173' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  describe('through puddle-connect', () => {
    let base: string;
    let server: ReturnType<typeof createServer>;
    beforeAll(async () => {
      const options: ServerOptions = { host: '127.0.0.1', port: 0, origins: [], allow: [], files: [], timeoutMs: 20_000, rowCap: 1000, concurrent: 2, log: () => undefined };
      server = createServer(options);
      base = await new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
    });
    afterAll(() => server.close());
    const post = (route: string, body: unknown) => fetch(`${base}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    it('lists the driver, tests the connection and streams a table', async () => {
      expect(((await (await fetch(`${base}/health`)).json()) as { drivers: string[] }).drivers).toContain('clickhouse');
      expect(await (await post('test', { driver: 'clickhouse', settings, secret })).json()).toMatchObject({ ok: true });
      const r = await post('read', { driver: 'clickhouse', settings, secret, table: { name: 'customers' }, limit: 10 });
      expect(r.status).toBe(200);
      expect(r.headers.get('puddle-rows')).toBe('3');
      expect(tableFromIPC(new Uint8Array(await r.arrayBuffer())).getChild('name')!.toArray()).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing']);
      expect((await post('read', { driver: 'clickhouse', settings, secret, query: 'DELETE FROM orders' })).status).toBe(400);
    });
  });
});
