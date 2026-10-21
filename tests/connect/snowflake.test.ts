// The Snowflake driver against a live SQL REST API, when PUDDLE_TEST_SNOWFLAKE names one: a URL such as
// snowflake://puddle@xy12345.eu-west-2.aws/shop/public?key=/path/to/key.p8&warehouse=compute_wh&url=http://127.0.0.1:18091,
// where the key is the user's private key (PKCS#8 PEM) and url is left out for the account's own host. CI runs it
// against scripts/snowflake-stand-in.mjs, which answers in the API's shapes and checks the signed sign-in; a real
// account (seeded with tests/fixtures/db/seed-snowflake.sql) is the proof. Without the variable it is skipped.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { snowflakeConnector } from '../../src/connect/drivers/snowflake';
import { createServer, type ServerOptions } from '../../src/connect/server';
import type { Connection } from '../../src/model';
import { keyedUrl } from '../helpers/testKey';

const url = process.env.PUDDLE_TEST_SNOWFLAKE;

describe.skipIf(!url)(`the snowflake driver against ${url ? new URL(url).host : 'no account'}`, () => {
  const { url: u, keyPath } = keyedUrl(url ?? 'snowflake://x@x/x/x');
  const [database = '', schema = ''] = u.pathname.split('/').slice(1);
  const settings = { account: u.hostname, user: decodeURIComponent(u.username), database, schema, ...Object.fromEntries(['warehouse', 'role', 'url'].filter((k) => u.searchParams.get(k)).map((k) => [k, u.searchParams.get(k)!])) };
  const secret = keyPath ? readFileSync(keyPath, 'utf8') : '';
  const connection: Connection = { id: 'c', name: 'shop', driver: 'snowflake', via: 'local', settings, auth: 'keypair' };
  const ctx = { connection, secret };
  const connector = snowflakeConnector();

  it('signs in with the key pair and names the server', async () => {
    const t = await connector.test(ctx);
    expect(t).toMatchObject({ ok: true });
    expect(t.ok && t.server).toMatch(/^Snowflake \d.*3 tables$/);
  });

  it('lists the schema’s tables with their types and row counts', async () => {
    const c = await connector.catalog(ctx);
    expect(c.tables.map((t) => [t.name, t.kind]).sort()).toEqual([
      ['CUSTOMERS', 'table'],
      ['ORDERS', 'table'],
      ['ORDER_TOTALS', 'view'],
    ]);
    const orders = c.tables.find((t) => t.name === 'ORDERS')!;
    expect(orders.rows).toBe(4);
    expect(orders.columns.find((x) => x.name === 'TOTAL')!.type).toBe('DECIMAL(10,2)');
    expect(orders.columns.find((x) => x.name === 'PLACED_AT')!.type).toBe('TIMESTAMP');
    expect(orders.columns.find((x) => x.name === 'TAGS')!.type).toBe('JSON');
    expect(orders.columns.find((x) => x.name === 'NOTES')!.nullable).toBe(true);
    expect(c.tables.find((t) => t.name === 'CUSTOMERS')!.columns.find((x) => x.name === 'ACTIVE')!.type).toBe('BOOLEAN');
  });

  it('documents the keys, comments, defaults, the identity column and the view', async () => {
    const d = await connector.document!(ctx);
    const customers = d.tables.find((t) => t.name === 'CUSTOMERS')!;
    const orders = d.tables.find((t) => t.name === 'ORDERS')!;
    expect(customers.note).toBe('People who have ordered');
    expect(customers.columns.find((c) => c.name === 'ID')).toMatchObject({ pk: true, notNull: true });
    expect(customers.columns.find((c) => c.name === 'EMAIL')).toMatchObject({ type: 'VARCHAR(255)', notNull: false, unique: true, note: 'Lower case' });
    expect(orders.columns.find((c) => c.name === 'ID')).toMatchObject({ pk: true, increment: true });
    expect(orders.columns.find((c) => c.name === 'STATUS')).toMatchObject({ default: "'placed'" });
    expect(orders.foreignKeys).toEqual([{ name: expect.any(String), columns: ['CUSTOMER_ID'], refTable: 'CUSTOMERS', refColumns: ['ID'] }]);
    expect(d.tables.find((t) => t.name === 'ORDER_TOTALS')!.sql).toMatch(/customers/i);
  });

  it('reads a table and a query with their values converted, and is refused a write', async () => {
    const r = await connector.read(ctx, { table: { name: 'ORDERS' } });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    const t = tableFromIPC(r.ipc);
    expect(Array.from(t.getChild('TOTAL')!.toArray(), Number).sort((a, b) => a - b)).toEqual([5.5, 19.99, 42.25, 120]);
    expect(Array.from(t.getChild('TAGS')!.toArray(), (x) => JSON.parse(String(x)))).toContainEqual(['gift', 'express']);
    const q = await connector.read(ctx, { query: 'SELECT name, signed_up, active FROM customers ORDER BY id', limit: 2 });
    if (!('ipc' in q)) throw new Error('expected a stream');
    expect(q.rows).toBe(2);
    expect(q.columns.map((c) => c.sqlType)).toEqual(['VARCHAR', 'DATE', 'BOOLEAN']);
    await expect(connector.read(ctx, { query: "UPDATE orders SET status = 'x' WHERE id = 101" })).rejects.toThrow(/answered/);
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
      expect(((await (await fetch(`${base}/health`)).json()) as { drivers: string[] }).drivers).toContain('snowflake');
      expect(await (await post('test', { driver: 'snowflake', settings, secret })).json()).toMatchObject({ ok: true });
      const r = await post('read', { driver: 'snowflake', settings, secret, table: { name: 'CUSTOMERS' }, limit: 10 });
      expect(r.status).toBe(200);
      expect(r.headers.get('puddle-rows')).toBe('3');
      expect(tableFromIPC(new Uint8Array(await r.arrayBuffer())).getChild('NAME')!.toArray()).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing']);
      expect((await post('read', { driver: 'snowflake', settings, secret, query: 'DELETE FROM orders' })).status).toBe(400);
    });
  });
});
