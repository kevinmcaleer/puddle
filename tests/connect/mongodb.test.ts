// The MongoDB driver against a live server, when PUDDLE_TEST_MONGODB names one: a URL such as
// mongodb://localhost:27017/shop or mongodb://user:password@host:27017/shop?authSource=admin, holding the shop of
// scripts/seed-mongodb.mjs. CI runs it against a MongoDB container; locally a FerretDB does (which has no views, so
// the view checks allow for its absence). Without the variable it is skipped.
import { tableFromIPC } from 'apache-arrow';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mongoConnector } from '../../src/connect/drivers/mongodb';
import { createServer, type ServerOptions } from '../../src/connect/server';
import type { Connection } from '../../src/model';

const url = process.env.PUDDLE_TEST_MONGODB;

describe.skipIf(!url)(`the mongodb driver against ${url ? new URL(url).host : 'no server'}`, () => {
  const u = new URL(url ?? 'mongodb://localhost/x');
  const settings = { url: `${u.protocol}//${u.host}`, database: u.pathname.slice(1), user: decodeURIComponent(u.username), ...(u.searchParams.get('authSource') ? { authSource: u.searchParams.get('authSource')! } : {}) };
  const connection: Connection = { id: 'c', name: 'shop', driver: 'mongodb', via: 'local', settings, auth: 'password' };
  const secret = decodeURIComponent(u.password);
  const ctx = { connection, secret };
  const connector = mongoConnector();

  it('connects and names the server', async () => {
    const t = await connector.test(ctx);
    expect(t).toMatchObject({ ok: true });
    expect(t.ok && t.server).toMatch(/^MongoDB \d.*[23] collections$/);
  });

  it('lists and documents the collections from their documents, reads a collection, a filter and a query, and refuses a write', async () => {
    const c = await connector.catalog(ctx);
    expect(c.tables.map((t) => t.name)).toEqual(expect.arrayContaining(['customers', 'orders']));
    const orders = c.tables.find((t) => t.name === 'orders')!;
    expect(orders.rows).toBe(4);
    expect(orders.columns.map((x) => [x.name, x.type])).toEqual(expect.arrayContaining([['_id', 'BIGINT'], ['placed_at', 'TIMESTAMP'], ['tags', 'JSON'], ['shipping.city', 'VARCHAR']]));
    const d = await connector.document!(ctx);
    expect(d.tables.find((t) => t.name === 'orders')!.columns.find((x) => x.name === '_id')).toMatchObject({ pk: true, notNull: true });
    expect(d.tables.find((t) => t.name === 'customers')!.indexes).toEqual([{ name: 'customers_email', columns: ['email'], unique: true }]);
    const view = d.tables.find((t) => t.name === 'order_totals');
    if (view) expect(view).toMatchObject({ kind: 'view', sql: expect.stringContaining('$lookup') });

    const r = await connector.read(ctx, { table: { name: 'orders' } });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(Array.from(tableFromIPC(r.ipc).getChild('total')!.toArray(), Number).sort((a, b) => a - b)).toEqual([5.5, 19.99, 42.25, 120]);
    const placed = await connector.read(ctx, { table: { name: 'orders' }, filter: "{ status: 'placed' }", limit: 10 });
    expect('ipc' in placed && placed.rows).toBe(2);
    const q = await connector.read(ctx, { query: 'db.customers.find({}, { name: 1, signed_up: 1, active: 1 })', limit: 2 });
    if (!('ipc' in q)) throw new Error('expected a stream');
    expect(q.rows).toBe(2);
    expect(q.columns.map((x) => x.sqlType)).toEqual(['BIGINT', 'VARCHAR', 'TIMESTAMP', 'BOOLEAN']);
    await expect(connector.read(ctx, { query: 'db.orders.aggregate([{ $match: {} }, { $merge: "orders_copy" }])' })).rejects.toThrow('writes');
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

    it('lists the driver, tests the connection, streams a filtered collection and refuses a pipeline that writes', async () => {
      expect(((await (await fetch(`${base}/health`)).json()) as { drivers: string[] }).drivers).toContain('mongodb');
      expect(await (await post('test', { driver: 'mongodb', settings, secret })).json()).toMatchObject({ ok: true });
      const r = await post('read', { driver: 'mongodb', settings, secret, table: { name: 'customers' }, filter: '{ "active": true }', limit: 10 });
      expect(r.status).toBe(200);
      expect(r.headers.get('puddle-rows')).toBe('2');
      expect(tableFromIPC(new Uint8Array(await r.arrayBuffer())).getChild('name')!.toArray()).toEqual(['Ada Lovelace', 'Grace Hopper']);
      expect((await post('read', { driver: 'mongodb', settings, secret, query: 'db.orders.aggregate([{ $out: "x" }])' })).status).toBe(422);
    });
  });
});
