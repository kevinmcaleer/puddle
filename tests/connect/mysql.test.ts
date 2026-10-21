// The MySQL family against a real server, when PUDDLE_TEST_MYSQL names one (a URL such as
// mysql://puddle:puddle@localhost:3306/shop, seeded with scripts/seed-mysql.mjs). CI runs it against MySQL and
// MariaDB; without the variable it is skipped, so `npm test` needs no database.
import { tableFromIPC } from 'apache-arrow';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mysqlConnector, type MysqlDriverId } from '../../src/connect/drivers/mysql';
import { createServer, type ServerOptions } from '../../src/connect/server';
import type { Connection } from '../../src/model';

const url = process.env.PUDDLE_TEST_MYSQL;
const driver = (process.env.PUDDLE_TEST_MYSQL_DRIVER ?? 'mysql') as MysqlDriverId;

describe.skipIf(!url)(`the ${driver} driver against ${url ? new URL(url).host : 'no server'}`, () => {
  const u = new URL(url ?? 'mysql://x@localhost/x');
  const settings = { host: u.hostname, port: Number(u.port) || 3306, database: u.pathname.slice(1), user: decodeURIComponent(u.username), ssl: false };
  const secret = decodeURIComponent(u.password);
  const connection: Connection = { id: 'c', name: 'shop', driver, via: 'local', settings, auth: 'password' };
  const ctx = { connection, secret };
  const connector = mysqlConnector(driver);

  it('connects and names the server', async () => {
    const t = await connector.test(ctx);
    expect(t).toMatchObject({ ok: true });
    expect(t.ok && t.server).toMatch(/^(MySQL|MariaDB|TiDB) .*3 tables$/);
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
    expect(orders.columns.find((x) => x.name === 'customer_id')!.nullable).toBe(false);
    expect(c.tables[0]!.columns.find((x) => x.name === 'active')!.type).toBe('BOOLEAN');
  });

  it('documents keys, the foreign key, the index, comments, the enum and the view', async () => {
    const d = await connector.document!(ctx);
    const customers = d.tables.find((t) => t.name === 'customers')!;
    const orders = d.tables.find((t) => t.name === 'orders')!;
    expect(customers.note).toBe('People who have ordered');
    expect(customers.columns.find((c) => c.name === 'id')).toMatchObject({ pk: true, notNull: true, increment: true });
    expect(customers.columns.find((c) => c.name === 'email')).toMatchObject({ unique: true, note: 'Lower case' });
    expect(orders.foreignKeys).toEqual([{ name: 'orders_customer_id_fkey', columns: ['customer_id'], refTable: 'customers', refColumns: ['id'] }]);
    expect(orders.indexes).toEqual([{ name: 'orders_customer', columns: ['customer_id'], unique: false }]);
    expect(orders.columns.find((c) => c.name === 'status')).toMatchObject({ type: 'orders_status', notNull: true, default: "'placed'" });
    expect(d.enums).toEqual([{ name: 'orders_status', values: ['placed', 'shipped', 'returned'] }]);
    expect(d.tables.find((t) => t.name === 'order_totals')!.sql).toMatch(/customers/i);
  });

  it('reads a table and a query with their values converted', async () => {
    const r = await connector.read(ctx, { table: { name: 'orders' } });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('total')!.toArray()).toEqual(['19.99', '5.50', '120.00', '42.25']);
    expect(Number(t.getChild('placed_at')!.get(0))).toBe(Date.UTC(2024, 3, 1, 9, 30));
    const q = await connector.read(ctx, { query: 'SELECT name, signed_up, active FROM customers ORDER BY id', limit: 2 });
    if (!('ipc' in q)) throw new Error('expected a stream');
    expect(q.rows).toBe(2);
    expect(q.columns.map((c) => c.sqlType)).toEqual(['VARCHAR', 'DATE', 'BOOLEAN']);
    expect(tableFromIPC(q.ipc).getChild('active')!.toArray()).toEqual([true, true]);
  });

  it('refuses to write', async () => {
    await expect(connector.read(ctx, { query: "UPDATE customers SET name = 'x'" })).rejects.toThrow(/READ ONLY|read-only|answered/);
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
      expect(((await (await fetch(`${base}/health`)).json()) as { drivers: string[] }).drivers).toContain(driver);
      expect(await (await post('test', { driver, settings, secret })).json()).toMatchObject({ ok: true });
      const r = await post('read', { driver, settings, secret, table: { name: 'customers' }, limit: 10 });
      expect(r.status).toBe(200);
      expect(r.headers.get('puddle-rows')).toBe('3');
      expect(tableFromIPC(new Uint8Array(await r.arrayBuffer())).getChild('name')!.toArray()).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing']);
      expect((await post('read', { driver, settings, secret, query: 'DELETE FROM orders' })).status).toBe(400);
    });
  });
});
