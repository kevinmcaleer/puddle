// The Trino driver against a real cluster, when PUDDLE_TEST_TRINO names one (a URL such as
// http://puddle@localhost:8080/memory/shop, seeded with scripts/seed-trino.mjs). CI runs it against the Trino
// container; without the variable it is skipped, so `npm test` needs no cluster.
import { tableFromIPC } from 'apache-arrow';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trinoConnector } from '../../src/connect/drivers/trino';
import { createServer, type ServerOptions } from '../../src/connect/server';
import type { Connection } from '../../src/model';

const url = process.env.PUDDLE_TEST_TRINO;

describe.skipIf(!url)(`the trino driver against ${url ? new URL(url).host : 'no server'}`, () => {
  const u = new URL(url ?? 'http://x@localhost/x/y');
  const [catalog = 'memory', schema = 'shop'] = u.pathname.slice(1).split('/');
  const settings = { url: u.origin, catalog, schema, user: decodeURIComponent(u.username) || 'puddle' };
  const secret = decodeURIComponent(u.password);
  const connection: Connection = { id: 'c', name: 'shop', driver: 'trino', via: 'local', settings, auth: 'password' };
  const ctx = { connection, ...(secret ? { secret } : {}) };
  const connector = trinoConnector();

  it('connects and names the cluster', async () => {
    const t = await connector.test(ctx);
    expect(t).toMatchObject({ ok: true });
    expect(t.ok && t.server).toMatch(/^Trino \S+, 3 tables$/);
  });

  it('lists the shop’s tables with their types', async () => {
    const c = await connector.catalog(ctx);
    expect(c.tables.map((t) => [t.name, t.kind]).sort()).toEqual([
      ['customers', 'table'],
      ['order_totals', 'view'],
      ['orders', 'table'],
    ]);
    const orders = c.tables.find((t) => t.name === 'orders')!;
    expect(orders.columns.find((x) => x.name === 'total')!.type).toBe('DECIMAL(10,2)');
    expect(orders.columns.find((x) => x.name === 'placed_at')!.type).toBe('TIMESTAMP');
    expect(orders.columns.find((x) => x.name === 'tags')!.type).toBe('JSON');
    expect(c.tables.find((t) => t.name === 'customers')!.columns.find((x) => x.name === 'active')!.type).toBe('BOOLEAN');
  });

  it('documents the declared types, comments and the view', async () => {
    const d = await connector.document!(ctx);
    const customers = d.tables.find((t) => t.name === 'customers')!;
    expect(customers.columns.find((c) => c.name === 'email')).toMatchObject({ type: 'varchar(255)', note: 'Lower case' });
    expect(d.tables.find((t) => t.name === 'orders')!.columns.find((c) => c.name === 'total')!.type).toBe('decimal(10,2)');
    expect(d.tables.find((t) => t.name === 'order_totals')!.sql).toMatch(/customers/i);
  });

  it('reads a table and a query with their values converted, and refuses to write', async () => {
    const r = await connector.read(ctx, { table: { name: 'orders' } });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    const t = tableFromIPC(r.ipc);
    expect(Array.from(t.getChild('total')!.toArray(), Number).sort((a, b) => a - b)).toEqual([5.5, 19.99, 42.25, 120]);
    const q = await connector.read(ctx, { query: 'SELECT name, signed_up, active FROM customers ORDER BY id', limit: 2 });
    if (!('ipc' in q)) throw new Error('expected a stream');
    expect(q.rows).toBe(2);
    expect(q.columns.map((c) => c.sqlType)).toEqual(['VARCHAR', 'DATE', 'BOOLEAN']);
    await expect(connector.read(ctx, { query: "UPDATE customers SET name = 'x'" })).rejects.toThrow(/answered/);
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
      expect(((await (await fetch(`${base}/health`)).json()) as { drivers: string[] }).drivers).toContain('trino');
      expect(await (await post('test', { driver: 'trino', settings, secret })).json()).toMatchObject({ ok: true });
      const r = await post('read', { driver: 'trino', settings, secret, table: { name: 'customers' }, limit: 10 });
      expect(r.status).toBe(200);
      expect(r.headers.get('puddle-rows')).toBe('3');
      expect(tableFromIPC(new Uint8Array(await r.arrayBuffer())).getChild('name')!.toArray().sort()).toEqual(['Ada Lovelace', 'Alan Turing', 'Grace Hopper']);
      expect((await post('read', { driver: 'trino', settings, secret, query: 'DELETE FROM orders' })).status).toBe(400);
    });
  });
});
