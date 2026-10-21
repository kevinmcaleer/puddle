// The SAP HANA driver against a real server, when PUDDLE_TEST_HANA names one: a URL such as
// hana://SHOP:password@localhost:39015/HXE (the path is the tenant database; add ?ssl=true for TLS), holding the shop
// of tests/fixtures/db/seed-hana.sql in the user's own schema. No HANA runs in CI; without the variable it is skipped.
import { tableFromIPC } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { hanaConnector } from '../../src/connect/drivers/hana';
import type { Connection } from '../../src/model';

const url = process.env.PUDDLE_TEST_HANA;

describe.skipIf(!url)(`the hana driver against ${url ? new URL(url).host : 'no server'}`, () => {
  const u = new URL(url ?? 'hana://x@localhost/x');
  const settings = { host: u.hostname, port: Number(u.port) || 39015, database: u.pathname.slice(1), user: decodeURIComponent(u.username), ssl: u.searchParams.get('ssl') === 'true', sslVerify: u.searchParams.get('sslVerify') !== 'false' };
  const connection: Connection = { id: 'c', name: 'shop', driver: 'hana', via: 'local', settings, auth: 'password' };
  const ctx = { connection, secret: decodeURIComponent(u.password) };
  const connector = hanaConnector();

  it('connects and names the server', async () => {
    const t = await connector.test(ctx);
    expect(t).toMatchObject({ ok: true });
    expect(t.ok && t.server).toMatch(/^SAP HANA \d.*3 tables$/);
  });

  it('lists and documents the shop, reads a table and a query, and can’t write', async () => {
    const c = await connector.catalog(ctx);
    expect(c.tables.map((t) => [t.name, t.kind]).sort()).toEqual([
      ['CUSTOMERS', 'table'],
      ['ORDERS', 'table'],
      ['ORDER_TOTALS', 'view'],
    ]);
    const d = await connector.document!(ctx);
    expect(d.tables.find((t) => t.name === 'ORDERS')!.foreignKeys).toEqual([{ name: expect.any(String), columns: ['CUSTOMER_ID'], refTable: 'CUSTOMERS', refColumns: ['ID'] }]);
    expect(d.tables.find((t) => t.name === 'CUSTOMERS')!.columns.find((x) => x.name === 'ID')).toMatchObject({ pk: true, increment: true });
    const r = await connector.read(ctx, { table: { name: 'ORDERS' } });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(Array.from(tableFromIPC(r.ipc).getChild('TOTAL')!.toArray(), Number).sort((a, b) => a - b)).toEqual([5.5, 19.99, 42.25, 120]);
    const q = await connector.read(ctx, { query: 'SELECT NAME, SIGNED_UP, ACTIVE FROM CUSTOMERS ORDER BY ID', limit: 2 });
    expect('ipc' in q && q.columns.map((x) => x.sqlType)).toEqual(['VARCHAR', 'DATE', 'BOOLEAN']);
    await expect(connector.read(ctx, { query: "UPDATE ORDERS SET STATUS = 'x'" })).rejects.toThrow();
  });
});
