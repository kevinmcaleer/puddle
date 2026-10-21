// The BigQuery driver against a live API, when PUDDLE_TEST_BIGQUERY names one: a URL such as
// bigquery://puddle-test/shop?key=/path/to/key.json&endpoint=http://127.0.0.1:18090, where the key is the service
// account's JSON key file and the endpoint is left out for Google's own. CI runs it against scripts/bigquery-stand-in.mjs,
// which answers in the API's shapes and checks the signed sign-in; a real project (seeded with
// tests/fixtures/db/seed-bigquery.sql) is the proof. Without the variable it is skipped.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bigqueryConnector } from '../../src/connect/drivers/bigquery';
import { createServer, type ServerOptions } from '../../src/connect/server';
import type { Connection } from '../../src/model';
import { keyedUrl } from '../helpers/testKey';

const url = process.env.PUDDLE_TEST_BIGQUERY;

describe.skipIf(!url)(`the bigquery driver against ${url ? new URL(url).host : 'no project'}`, () => {
  const { url: u, keyPath } = keyedUrl(url ?? 'bigquery://x/x');
  const endpoint = u.searchParams.get('endpoint');
  const settings = { project: u.hostname, dataset: u.pathname.slice(1), ...(endpoint ? { endpoint } : {}) };
  const secret = keyPath ? readFileSync(keyPath, 'utf8') : '';
  const connection: Connection = { id: 'c', name: 'shop', driver: 'bigquery', via: 'local', settings, auth: 'key' };
  const ctx = { connection, secret };
  const connector = bigqueryConnector();

  it('signs in with the key and names the project', async () => {
    const t = await connector.test(ctx);
    expect(t).toMatchObject({ ok: true });
    expect(t.ok && t.server).toBe(`BigQuery project ${settings.project}, 3 tables`);
  });

  it('lists the dataset’s tables with their types and row counts', async () => {
    const c = await connector.catalog(ctx);
    expect(c.tables.map((t) => [t.name, t.kind]).sort()).toEqual([
      ['customers', 'table'],
      ['order_totals', 'view'],
      ['orders', 'table'],
    ]);
    const orders = c.tables.find((t) => t.name === 'orders')!;
    expect(orders.rows).toBe(4);
    expect(orders.columns.find((x) => x.name === 'total')!.type).toBe('DECIMAL(38,9)');
    expect(orders.columns.find((x) => x.name === 'placed_at')!.type).toBe('TIMESTAMP');
    expect(orders.columns.find((x) => x.name === 'tags')!.type).toBe('JSON');
    expect(orders.columns.find((x) => x.name === 'shipping')!.type).toBe('JSON');
    expect(orders.columns.find((x) => x.name === 'notes')!.nullable).toBe(true);
    expect(c.tables.find((t) => t.name === 'customers')!.columns.find((x) => x.name === 'active')!.type).toBe('BOOLEAN');
  });

  it('documents the keys, descriptions, defaults and the view', async () => {
    const d = await connector.document!(ctx);
    const customers = d.tables.find((t) => t.name === 'customers')!;
    const orders = d.tables.find((t) => t.name === 'orders')!;
    expect(customers.note).toBe('People who have ordered');
    expect(customers.columns.find((c) => c.name === 'id')).toMatchObject({ pk: true, notNull: true });
    expect(customers.columns.find((c) => c.name === 'email')).toMatchObject({ type: 'STRING', notNull: false, note: 'Lower case' });
    expect(orders.columns.find((c) => c.name === 'status')).toMatchObject({ default: "'placed'" });
    expect(orders.foreignKeys).toEqual([{ name: expect.any(String), columns: ['customer_id'], refTable: 'customers', refColumns: ['id'] }]);
    expect(d.tables.find((t) => t.name === 'order_totals')!.sql).toMatch(/customers/i);
  });

  it('reads a table and a query with their values converted, and can’t write with a read-only token', async () => {
    const r = await connector.read(ctx, { table: { name: 'orders' } });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    const t = tableFromIPC(r.ipc);
    expect(Array.from(t.getChild('total')!.toArray(), Number).sort((a, b) => a - b)).toEqual([5.5, 19.99, 42.25, 120]);
    expect(t.getChild('tags')!.toArray()).toContain('["gift","express"]');
    const q = await connector.read(ctx, { query: 'SELECT name, signed_up, active FROM customers ORDER BY id', limit: 2 });
    if (!('ipc' in q)) throw new Error('expected a stream');
    expect(q.rows).toBe(2);
    expect(q.columns.map((c) => c.sqlType)).toEqual(['VARCHAR', 'DATE', 'BOOLEAN']);
    await expect(connector.read(ctx, { query: "UPDATE orders SET status = 'x' WHERE id = 101" })).rejects.toThrow(/may not read|answered/);
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
      expect(((await (await fetch(`${base}/health`)).json()) as { drivers: string[] }).drivers).toContain('bigquery');
      expect(await (await post('test', { driver: 'bigquery', settings, secret })).json()).toMatchObject({ ok: true });
      const r = await post('read', { driver: 'bigquery', settings, secret, table: { name: 'customers' }, limit: 10 });
      expect(r.status).toBe(200);
      expect(r.headers.get('puddle-rows')).toBe('3');
      expect(tableFromIPC(new Uint8Array(await r.arrayBuffer())).getChild('name')!.toArray()).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing']);
      expect((await post('read', { driver: 'bigquery', settings, secret, query: 'DELETE FROM orders WHERE true' })).status).toBe(400);
    });
  });
});
