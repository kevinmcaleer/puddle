// The Cassandra driver against a live server, when PUDDLE_TEST_CASSANDRA names one: a URL such as
// cassandra://localhost:9042/shop?datacenter=datacenter1 (credentials as user:password@), holding the shop of
// tests/fixtures/db/seed-cassandra.cql. PUDDLE_TEST_CASSANDRA_DRIVER says which of the pair it is, cassandra or
// scylla; CI runs both. Without the variable it is skipped.
import { tableFromIPC } from 'apache-arrow';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cassandraConnector } from '../../src/connect/drivers/cassandra';
import { createServer, type ServerOptions } from '../../src/connect/server';
import type { Connection } from '../../src/model';

const url = process.env.PUDDLE_TEST_CASSANDRA;
const driver = process.env.PUDDLE_TEST_CASSANDRA_DRIVER === 'scylla' ? 'scylla' : 'cassandra';

describe.skipIf(!url)(`the ${driver} driver against ${url ? new URL(url).host : 'no server'}`, () => {
  const u = new URL(url ?? 'cassandra://localhost/x');
  const settings = { host: u.hostname, port: Number(u.port) || 9042, keyspace: u.pathname.slice(1), datacenter: u.searchParams.get('datacenter') ?? 'datacenter1', user: decodeURIComponent(u.username) };
  const connection: Connection = { id: 'c', name: 'shop', driver, via: 'local', settings, auth: 'password' };
  const secret = decodeURIComponent(u.password);
  const ctx = { connection, secret };
  const connector = cassandraConnector(driver);

  it('connects and names the server', async () => {
    const t = await connector.test(ctx);
    expect(t).toMatchObject({ ok: true });
    expect(t.ok && t.server).toMatch(driver === 'scylla' ? /^ScyllaDB .*2 tables$/ : /^Cassandra \d.*2 tables$/);
  });

  it('lists and documents the keyspace, reads a table, a condition and a query, and can’t write', async () => {
    const c = await connector.catalog(ctx);
    expect(c.tables.map((t) => [t.schema, t.name, t.kind])).toEqual([
      ['shop', 'customers', 'table'],
      ['shop', 'orders', 'table'],
      ['shop', 'orders_by_status', 'view'],
    ]);
    expect(c.tables.find((t) => t.name === 'orders')!.columns.find((x) => x.name === 'total')!.type).toBe('DECIMAL(38,9)');
    const d = await connector.document!(ctx);
    const orders = d.tables.find((t) => t.name === 'orders')!;
    expect(orders.columns.filter((x) => x.pk).map((x) => x.name)).toEqual(['customer_id', 'id']);
    expect(orders.indexes).toEqual([{ name: 'orders_status', columns: ['status'], unique: false }]);
    expect(d.tables.find((t) => t.name === 'customers')!.note).toBe('People who have ordered');

    const r = await connector.read(ctx, { table: { schema: 'shop', name: 'orders' } });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(Array.from(tableFromIPC(r.ipc).getChild('total')!.toArray(), Number).sort((a, b) => a - b)).toEqual([5.5, 19.99, 42.25, 120]);
    const placed = await connector.read(ctx, { table: { schema: 'shop', name: 'orders' }, filter: "status = 'placed'" });
    expect('ipc' in placed && placed.rows).toBe(2);
    await expect(connector.read(ctx, { table: { schema: 'shop', name: 'orders' }, filter: 'total > 10' })).rejects.toThrow('turn on Allow filtering');
    const scanned = await connector.read(ctx, { table: { schema: 'shop', name: 'orders' }, filter: 'total > 10', allowFiltering: true });
    expect('ipc' in scanned && scanned.rows).toBe(3);
    const q = await connector.read(ctx, { query: 'SELECT name, signed_up, active FROM shop.customers', limit: 2 });
    if (!('ipc' in q)) throw new Error('expected a stream');
    expect(q.rows).toBe(2);
    expect(q.columns.map((x) => x.sqlType)).toEqual(['VARCHAR', 'DATE', 'BOOLEAN']);
    await expect(connector.read(ctx, { query: "UPDATE shop.orders SET status = 'x' WHERE customer_id = 1 AND id = 101" })).rejects.toThrow();
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

    it('lists the driver, tests the connection and streams a table with its condition', async () => {
      expect(((await (await fetch(`${base}/health`)).json()) as { drivers: string[] }).drivers).toContain(driver);
      expect(await (await post('test', { driver, settings, secret })).json()).toMatchObject({ ok: true });
      const r = await post('read', { driver, settings, secret, table: { schema: 'shop', name: 'orders' }, filter: 'total > 10', allowFiltering: true, limit: 10 });
      expect(r.status).toBe(200);
      expect(r.headers.get('puddle-rows')).toBe('3');
      expect([...tableFromIPC(new Uint8Array(await r.arrayBuffer())).getChild('status')!.toArray()].sort()).toEqual(['placed', 'returned', 'shipped']);
      expect((await post('read', { driver, settings, secret, query: 'TRUNCATE shop.orders' })).status).toBe(400);
    });
  });
});
