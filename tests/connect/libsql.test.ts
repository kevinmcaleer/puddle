// The LibSQL driver against a live Hrana server, when PUDDLE_TEST_LIBSQL names one: a URL such as
// http://:token@localhost:8080 (the password is the token; none for a sqld with no auth), seeded with
// scripts/seed-libsql.mjs. CI runs it against the sqld container; locally scripts/libsql-stand-in.mjs serves.
// Without the variable it is skipped.
import { tableFromIPC } from 'apache-arrow';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hranaConnector } from '../../src/connect/drivers/hrana';
import { createServer, type ServerOptions } from '../../src/connect/server';
import type { Connection } from '../../src/model';

const url = process.env.PUDDLE_TEST_LIBSQL;

describe.skipIf(!url)(`the libsql driver against ${url ? new URL(url).host : 'no server'}`, () => {
  const u = new URL(url ?? 'http://localhost/');
  const settings = { url: u.origin };
  const secret = decodeURIComponent(u.password);
  const connection: Connection = { id: 'c', name: 'shop', driver: 'libsql', via: 'local', settings, auth: 'token' };
  const ctx = { connection, secret };
  const connector = hranaConnector();

  it('connects and names the server', async () => {
    const t = await connector.test(ctx);
    expect(t).toMatchObject({ ok: true });
    expect(t.ok && t.server).toMatch(/^(sqld \S+|LibSQL), 3 tables$/);
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
    expect(orders.columns.find((x) => x.name === 'notes')!.nullable).toBe(true);
  });

  it('documents the keys, the unique email, the default, the autoincrement, the index, the foreign key and the view', async () => {
    const d = await connector.document!(ctx);
    const customers = d.tables.find((t) => t.name === 'customers')!;
    const orders = d.tables.find((t) => t.name === 'orders')!;
    expect(customers.columns.find((c) => c.name === 'id')).toMatchObject({ pk: true, notNull: true, increment: true });
    expect(customers.columns.find((c) => c.name === 'email')).toMatchObject({ unique: true, notNull: false });
    expect(customers.columns.find((c) => c.name === 'active')).toMatchObject({ default: '1' });
    expect(orders.indexes).toEqual([{ name: 'orders_customer', columns: ['customer_id'], unique: false }]);
    expect(orders.foreignKeys).toEqual([{ columns: ['customer_id'], refTable: 'customers', refColumns: ['id'] }]);
    expect(d.tables.find((t) => t.name === 'order_totals')!.sql).toMatch(/customers/i);
  });

  it('reads a table and a query, and refuses a write before sending it', async () => {
    const r = await connector.read(ctx, { table: { name: 'orders' } });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(Array.from(tableFromIPC(r.ipc).getChild('total')!.toArray(), Number).sort((a, b) => a - b)).toEqual([5.5, 19.99, 42.25, 120]);
    const q = await connector.read(ctx, { query: 'SELECT name, signed_up, active FROM customers ORDER BY id', limit: 2 });
    if (!('ipc' in q)) throw new Error('expected a stream');
    expect(q.rows).toBe(2);
    // A server that says the columns' declared types gives BOOLEAN; one that doesn't, the integers it holds.
    expect(q.columns.map((c) => c.sqlType).slice(0, 2)).toEqual(['VARCHAR', 'VARCHAR']);
    expect(q.columns[2]!.sqlType).toMatch(/^(BOOLEAN|BIGINT)$/);
    await expect(connector.read(ctx, { query: "UPDATE orders SET status = 'x'" })).rejects.toThrow(/Only a query that reads/);
    const again = await connector.read(ctx, { query: "SELECT status FROM orders WHERE status = 'x'" });
    expect('ipc' in again && again.rows).toBe(0);
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
      expect(((await (await fetch(`${base}/health`)).json()) as { drivers: string[] }).drivers).toContain('libsql');
      expect(await (await post('test', { driver: 'libsql', settings, secret })).json()).toMatchObject({ ok: true });
      const r = await post('read', { driver: 'libsql', settings, secret, table: { name: 'customers' }, limit: 10 });
      expect(r.status).toBe(200);
      expect(r.headers.get('puddle-rows')).toBe('3');
      expect(tableFromIPC(new Uint8Array(await r.arrayBuffer())).getChild('name')!.toArray()).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing']);
      expect((await post('read', { driver: 'libsql', settings, secret, query: 'DELETE FROM orders' })).status).toBe(400);
    });
  });
});
