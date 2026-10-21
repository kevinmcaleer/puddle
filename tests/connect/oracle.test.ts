// The Oracle driver against a real server, when PUDDLE_TEST_ORACLE names one (a URL such as
// oracle://shop:puddle@localhost:1521/FREEPDB1, seeded with scripts/seed-oracle.mjs). CI runs it against the Oracle
// Free container; without the variable it is skipped, so `npm test` needs no database.
import { tableFromIPC } from 'apache-arrow';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oracleConnector } from '../../src/connect/drivers/oracle';
import { createServer, type ServerOptions } from '../../src/connect/server';
import type { Connection } from '../../src/model';

const url = process.env.PUDDLE_TEST_ORACLE;

describe.skipIf(!url)(`the oracle driver against ${url ? new URL(url).host : 'no server'}`, () => {
  const u = new URL(url ?? 'oracle://x@localhost/x');
  const settings = { host: u.hostname, port: Number(u.port) || 1521, service: u.pathname.slice(1), user: decodeURIComponent(u.username) };
  const secret = decodeURIComponent(u.password);
  const connection: Connection = { id: 'c', name: 'shop', driver: 'oracle', via: 'local', settings, auth: 'password' };
  const ctx = { connection, secret };
  const connector = oracleConnector();

  it('connects and names the server', async () => {
    const t = await connector.test(ctx);
    expect(t).toMatchObject({ ok: true });
    expect(t.ok && t.server).toMatch(/^Oracle Database \d.*3 tables$/);
  });

  it('lists the shop’s tables with their types', async () => {
    const c = await connector.catalog(ctx);
    expect(c.tables.map((t) => [t.name, t.kind]).sort()).toEqual([
      ['CUSTOMERS', 'table'],
      ['ORDERS', 'table'],
      ['ORDER_TOTALS', 'view'],
    ]);
    const orders = c.tables.find((t) => t.name === 'ORDERS')!;
    expect(orders.columns.find((x) => x.name === 'TOTAL')!.type).toBe('DECIMAL(10,2)');
    expect(orders.columns.find((x) => x.name === 'ID')!.type).toBe('BIGINT');
    expect(orders.columns.find((x) => x.name === 'PLACED_AT')!.type).toBe('TIMESTAMP');
    expect(orders.columns.find((x) => x.name === 'CUSTOMER_ID')!.nullable).toBe(false);
    expect(c.tables.find((t) => t.name === 'CUSTOMERS')!.columns.find((x) => x.name === 'ACTIVE')!.type).toBe('INTEGER');
  });

  it('documents keys, the foreign key, the index, comments and the view', async () => {
    const d = await connector.document!(ctx);
    const customers = d.tables.find((t) => t.name === 'CUSTOMERS')!;
    const orders = d.tables.find((t) => t.name === 'ORDERS')!;
    expect(customers.note).toBe('People who have ordered');
    expect(customers.columns.find((c) => c.name === 'ID')).toMatchObject({ pk: true, notNull: true, increment: true });
    expect(customers.columns.find((c) => c.name === 'EMAIL')).toMatchObject({ unique: true, note: 'Lower case' });
    expect(orders.foreignKeys).toEqual([{ name: 'ORDERS_CUSTOMER_ID_FKEY', columns: ['CUSTOMER_ID'], refTable: 'CUSTOMERS', refColumns: ['ID'] }]);
    expect(orders.indexes).toEqual([{ name: 'ORDERS_CUSTOMER', columns: ['CUSTOMER_ID'], unique: false }]);
    expect(orders.columns.find((c) => c.name === 'STATUS')).toMatchObject({ type: 'VARCHAR2(10)', notNull: true, default: "'placed'" });
    expect(orders.columns.find((c) => c.name === 'TOTAL')).toMatchObject({ type: 'NUMBER(10,2)' });
    expect(d.tables.find((t) => t.name === 'ORDER_TOTALS')!.sql).toMatch(/customers/i);
  });

  it('reads a table and a query with their values converted', async () => {
    const r = await connector.read(ctx, { table: { name: 'ORDERS' } });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('TOTAL')!.toArray().map(Number)).toEqual([19.99, 5.5, 120, 42.25]);
    expect(Number(t.getChild('PLACED_AT')!.get(0))).toBe(Date.UTC(2024, 3, 1, 9, 30));
    const q = await connector.read(ctx, { query: 'SELECT name, signed_up, active FROM customers ORDER BY id', limit: 2 });
    if (!('ipc' in q)) throw new Error('expected a stream');
    expect(q.rows).toBe(2);
    expect(q.columns.map((c) => c.sqlType)).toEqual(['VARCHAR', 'TIMESTAMP', 'INTEGER']);
    expect(tableFromIPC(q.ipc).getChild('ACTIVE')!.toArray().map(Number)).toEqual([1, 1]);
  });

  it('refuses to write', async () => {
    await expect(connector.read(ctx, { query: "UPDATE customers SET name = 'x'" })).rejects.toThrow(/read-only|answered/);
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
      expect(((await (await fetch(`${base}/health`)).json()) as { drivers: string[] }).drivers).toContain('oracle');
      expect(await (await post('test', { driver: 'oracle', settings, secret })).json()).toMatchObject({ ok: true });
      const r = await post('read', { driver: 'oracle', settings, secret, table: { name: 'CUSTOMERS' }, limit: 10 });
      expect(r.status).toBe(200);
      expect(r.headers.get('puddle-rows')).toBe('3');
      expect(tableFromIPC(new Uint8Array(await r.arrayBuffer())).getChild('NAME')!.toArray()).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing']);
      expect((await post('read', { driver: 'oracle', settings, secret, query: 'DELETE FROM orders' })).status).toBe(400);
    });
  });
});
