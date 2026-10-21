// The SurrealDB driver against a live server, when PUDDLE_TEST_SURREALDB names one: a URL such as
// http://root:root@localhost:8000/shop/shop (the path is the namespace and database; `?level=database` for a user
// defined on the database), seeded with scripts/seed-surrealdb.mjs. CI runs it against the SurrealDB container;
// without the variable it is skipped.
import { tableFromIPC } from 'apache-arrow';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { surrealConnector } from '../../src/connect/drivers/surrealdb';
import { createServer, type ServerOptions } from '../../src/connect/server';
import type { Connection } from '../../src/model';

const url = process.env.PUDDLE_TEST_SURREALDB;

describe.skipIf(!url)(`the surrealdb driver against ${url ? new URL(url).host : 'no server'}`, () => {
  const u = new URL(url ?? 'http://x@localhost/x/x');
  const [namespace = '', database = ''] = u.pathname.split('/').slice(1);
  const settings = { url: u.origin, namespace, database, user: decodeURIComponent(u.username), level: u.searchParams.get('level') ?? 'root' };
  const secret = decodeURIComponent(u.password);
  const connection: Connection = { id: 'c', name: 'shop', driver: 'surrealdb', via: 'local', settings, auth: 'password' };
  const ctx = { connection, secret };
  const connector = surrealConnector();

  it('connects and names the server', async () => {
    const t = await connector.test(ctx);
    expect(t).toMatchObject({ ok: true });
    expect(t.ok && t.server).toMatch(/^SurrealDB \d.*2 tables$/);
  });

  it('lists the tables with their columns from the declared fields and the records, and their counts', async () => {
    const c = await connector.catalog(ctx);
    expect(c.tables.map((t) => [t.name, t.rows])).toEqual([
      ['customers', 3],
      ['orders', 4],
    ]);
    const orders = c.tables.find((t) => t.name === 'orders')!;
    expect(orders.columns.find((x) => x.name === 'total')!.type).toBe('DECIMAL(38,9)');
    expect(orders.columns.find((x) => x.name === 'placed_at')!.type).toBe('TIMESTAMP');
    expect(orders.columns.find((x) => x.name === 'tags')!.type).toBe('JSON');
    expect(orders.columns.find((x) => x.name === 'shipping.city')!.nullable).toBe(true);
    expect(c.tables.find((t) => t.name === 'customers')!.columns.find((x) => x.name === 'active')!.type).toBe('BOOLEAN');
  });

  it('documents the declared fields, the comment, the default, the unique index and the record link', async () => {
    const d = await connector.document!(ctx);
    const customers = d.tables.find((t) => t.name === 'customers')!;
    const orders = d.tables.find((t) => t.name === 'orders')!;
    expect(customers.note).toMatch(/^People who have ordered\. Inferred from 3 documents/);
    expect(customers.columns.find((c) => c.name === 'id')).toMatchObject({ pk: true, notNull: true });
    expect(customers.columns.find((c) => c.name === 'email')).toMatchObject({ type: 'option<string>', unique: true, note: 'Lower case' });
    expect(customers.columns.find((c) => c.name === 'active')).toMatchObject({ type: 'bool', default: 'true' });
    expect(orders.foreignKeys).toEqual([{ columns: ['customer'], refTable: 'customers', refColumns: ['id'] }]);
    expect(orders.columns.find((c) => c.name === 'notes')!.note).toBe('present in 25% of documents');
  });

  it('reads a table and a query with their values converted, and refuses a write before sending it', async () => {
    const r = await connector.read(ctx, { table: { name: 'orders' } });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    const t = tableFromIPC(r.ipc);
    expect(Array.from(t.getChild('total')!.toArray(), Number).sort((a, b) => a - b)).toEqual([5.5, 19.99, 42.25, 120]);
    expect(t.getChild('tags')!.toArray()).toContain('["gift","express"]');
    const q = await connector.read(ctx, { query: 'SELECT name, active, id FROM customers ORDER BY id', limit: 2 });
    if (!('ipc' in q)) throw new Error('expected a stream');
    expect(q.rows).toBe(2);
    expect(q.columns.map((c) => [c.name, c.sqlType])).toEqual([
      ['active', 'BOOLEAN'],
      ['id', 'VARCHAR'],
      ['name', 'VARCHAR'],
    ]);
    await expect(connector.read(ctx, { query: "UPDATE orders:101 SET status = 'x'" })).rejects.toThrow(/Only a query that reads/);
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
      expect(((await (await fetch(`${base}/health`)).json()) as { drivers: string[] }).drivers).toContain('surrealdb');
      expect(await (await post('test', { driver: 'surrealdb', settings, secret })).json()).toMatchObject({ ok: true });
      const r = await post('read', { driver: 'surrealdb', settings, secret, table: { name: 'customers' }, limit: 10 });
      expect(r.status).toBe(200);
      expect(r.headers.get('puddle-rows')).toBe('3');
      expect(tableFromIPC(new Uint8Array(await r.arrayBuffer())).getChild('name')!.toArray()).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing']);
      expect((await post('read', { driver: 'surrealdb', settings, secret, query: 'DELETE orders' })).status).toBe(400);
    });
  });
});
