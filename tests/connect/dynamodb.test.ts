// The DynamoDB driver against a live DynamoDB, when PUDDLE_TEST_DYNAMODB names one: a URL such as
// dynamodb://AKIDEXAMPLE:secretexample@eu-west-2?endpoint=http://localhost:8002 (the user and password are the access
// key id and secret access key; the endpoint is left out for the real service), seeded with scripts/seed-dynamodb.mjs.
// CI runs it against DynamoDB Local, which accepts any key, so its URL adds &signatures=unchecked and the wrong-secret
// check is left out; locally scripts/dynamodb-stand-in.mjs serves, and checks them. Without the variable it is skipped.
import { tableFromIPC } from 'apache-arrow';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dynamoConnector } from '../../src/connect/drivers/dynamodb';
import { createServer, type ServerOptions } from '../../src/connect/server';
import type { Connection } from '../../src/model';

const url = process.env.PUDDLE_TEST_DYNAMODB;

describe.skipIf(!url)(`the dynamodb driver against ${url ? new URL(url).searchParams.get('endpoint') ?? new URL(url).hostname : 'no table store'}`, () => {
  const u = new URL(url ?? 'dynamodb://k:s@r');
  const endpoint = u.searchParams.get('endpoint');
  const checksSignatures = u.searchParams.get('signatures') !== 'unchecked';
  const settings = { region: u.hostname, accessKeyId: decodeURIComponent(u.username), ...(endpoint ? { endpoint } : {}) };
  const secret = decodeURIComponent(u.password);
  const connection: Connection = { id: 'c', name: 'shop', driver: 'dynamodb', via: 'local', settings, auth: 'aws' };
  const ctx = { connection, secret };
  const connector = dynamoConnector();

  it('signs in and counts the tables', async () => {
    expect(await connector.test(ctx)).toEqual({ ok: true, server: `DynamoDB in ${settings.region}, 2 tables` });
    if (checksSignatures) expect(await connector.test({ ...ctx, secret: 'wrong' })).toMatchObject({ ok: false });
  });

  it('lists the tables with their keys first and the columns the items show', async () => {
    const c = await connector.catalog(ctx);
    expect(c.tables.map((t) => t.name)).toEqual(['customers', 'orders']);
    const orders = c.tables.find((t) => t.name === 'orders')!;
    expect(orders.columns.slice(0, 2).map((x) => [x.name, x.type])).toEqual([
      ['customer_id', 'BIGINT'],
      ['id', 'BIGINT'],
    ]);
    expect(orders.columns.find((x) => x.name === 'total')!.type).toBe('DOUBLE');
    expect(orders.columns.find((x) => x.name === 'tags')!.type).toBe('JSON');
    expect(orders.columns.find((x) => x.name === 'shipping.city')!.nullable).toBe(true);
    expect(c.tables.find((t) => t.name === 'customers')!.columns.find((x) => x.name === 'active')!.type).toBe('BOOLEAN');
  });

  it('documents the key schema, the index and the inferred columns', async () => {
    const d = await connector.document!(ctx);
    const orders = d.tables.find((t) => t.name === 'orders')!;
    expect(orders.note).toMatch(/^Partition key customer_id, sort key id\. Inferred from 4 documents/);
    expect(orders.columns.filter((c) => c.pk).map((c) => c.name)).toEqual(['customer_id', 'id']);
    expect(orders.indexes).toEqual([{ name: 'orders_status', columns: ['status'], unique: false }]);
    expect(orders.columns.find((c) => c.name === 'notes')!.note).toBe('present in 25% of documents');
    expect(d.tables.find((t) => t.name === 'customers')!.columns.find((c) => c.name === 'id')).toMatchObject({ pk: true, unique: true });
  });

  it('scans a table, runs a PartiQL SELECT, and refuses a write before sending it', async () => {
    const r = await connector.read(ctx, { table: { name: 'orders' } });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    const t = tableFromIPC(r.ipc);
    expect(Array.from(t.getChild('total')!.toArray(), Number).sort((a, b) => a - b)).toEqual([5.5, 19.99, 42.25, 120]);
    expect(t.getChild('tags')!.toArray()).toContain('["gift","express"]');
    const two = await connector.read(ctx, { table: { name: 'orders' }, limit: 2 });
    expect('ipc' in two && two.rows).toBe(2);
    const q = await connector.read(ctx, { query: 'SELECT * FROM "orders" WHERE customer_id = 1', limit: 10 });
    if (!('ipc' in q)) throw new Error('expected a stream');
    expect(q.rows).toBe(2);
    expect(q.columns.find((c) => c.name === 'status')!.sqlType).toBe('VARCHAR');
    await expect(connector.read(ctx, { query: `UPDATE "orders" SET status = 'x' WHERE customer_id = 1 AND id = 101` })).rejects.toThrow(/Only a SELECT/);
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
      expect(((await (await fetch(`${base}/health`)).json()) as { drivers: string[] }).drivers).toContain('dynamodb');
      expect(await (await post('test', { driver: 'dynamodb', settings, secret })).json()).toMatchObject({ ok: true });
      const r = await post('read', { driver: 'dynamodb', settings, secret, table: { name: 'customers' }, limit: 10 });
      expect(r.status).toBe(200);
      expect(r.headers.get('puddle-rows')).toBe('3');
      expect([...tableFromIPC(new Uint8Array(await r.arrayBuffer())).getChild('name')!.toArray()].sort()).toEqual(['Ada Lovelace', 'Alan Turing', 'Grace Hopper']);
      expect((await post('read', { driver: 'dynamodb', settings, secret, query: 'DELETE FROM "orders" WHERE id = 1' })).status).toBe(400);
    });
  });
});
