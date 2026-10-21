// The Cassandra driver against the calls recorded from a Cassandra 5 (tests/fixtures/db/cassandra/, regenerated with
// scripts/record-database.mjs cassandra <url>), and against a server that refuses a part. ScyllaDB is the same
// driver under its own name.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { replayClient } from '../../../tests/helpers/replayCalls';
import type { Connection } from '../../model';
import { ConnectorError, type CatalogDetail } from '../types';
import { cassandraConfigFor, cassandraConnector, cassandraProblem, indexColumn, inKeyspace, orderedColumns, readCql, TABLES_CQL, userViews, type CqlClientLike } from './cassandra';

const recorded = JSON.parse(readFileSync(join(__dirname, '../../../tests/fixtures/db/cassandra/catalog.json'), 'utf8')) as { test: unknown; catalog: unknown; detail: CatalogDetail };

const replay = (refuse?: RegExp, onEnd?: () => void) => async () => replayClient<CqlClientLike>('cassandra', { refuse: (_method, args) => (refuse?.test(String(args[0])) ? new Error('Unauthorized: User puddle has no SELECT permission on <table shop.orders>') : undefined), onEnd });

const connection: Connection = { id: 'c', name: 'shop', driver: 'cassandra', via: 'local', settings: { host: '127.0.0.1', port: 19042, keyspace: 'shop', datacenter: 'datacenter1' }, auth: 'password' };
const ctx = { connection, secret: '' };

describe('the Cassandra driver', () => {
  it('tests, catalogues and documents the shop as recorded: keys as the primary key, the index, the materialized view', async () => {
    const c = cassandraConnector('cassandra', replay());
    expect(await c.test(ctx)).toEqual(recorded.test);
    expect(await c.catalog(ctx)).toEqual(recorded.catalog);
    expect(await c.document!(ctx)).toEqual(recorded.detail);
    const orders = recorded.detail.tables.find((t) => t.name === 'orders')!;
    expect(orders.columns.slice(0, 2)).toEqual([
      { name: 'customer_id', type: 'int', pk: true, unique: false, notNull: true, increment: false, note: 'partition key' },
      { name: 'id', type: 'int', pk: true, unique: false, notNull: true, increment: false, note: 'clustering key, descending' },
    ]);
    expect(orders.indexes).toEqual([{ name: 'orders_status', columns: ['status'], unique: false }]);
    expect(recorded.detail.tables.find((t) => t.name === 'customers')).toMatchObject({ note: 'People who have ordered', columns: expect.arrayContaining([{ name: 'id', type: 'int', pk: true, unique: true, notNull: true, increment: false }]) });
    const view = recorded.detail.tables.find((t) => t.name === 'orders_by_status')!;
    expect(view).toMatchObject({ kind: 'view', note: 'A materialized view of orders' });
    expect(view.columns.map((x) => [x.name, x.pk])).toEqual([
      ['status', true],
      ['customer_id', true],
      ['id', true],
      ['total', false],
    ]);
  });

  it('names ScyllaDB by its own name', async () => {
    // A Cassandra has no system.versions (ScyllaDB's own), so the version comes from system.local.
    expect(await cassandraConnector('scylla', replay(/system\.versions/)).test({ ...ctx, connection: { ...connection, driver: 'scylla' } })).toEqual({ ok: true, server: 'ScyllaDB 5.0.9, 2 tables' });
  });

  it('reads a table as an Arrow stream: the decimal exact, the timestamp parsed, the map as JSON, the null kept', async () => {
    const r = await cassandraConnector('cassandra', replay()).read(ctx, { table: { schema: 'shop', name: 'orders' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(r.columns).toEqual([
      { name: 'customer_id', sqlType: 'INTEGER' },
      { name: 'id', sqlType: 'INTEGER' },
      { name: 'notes', sqlType: 'VARCHAR' },
      { name: 'placed_at', sqlType: 'TIMESTAMP' },
      { name: 'shipping', sqlType: 'JSON' },
      { name: 'status', sqlType: 'VARCHAR' },
      { name: 'total', sqlType: 'DECIMAL(38,9)' },
    ]);
    const t = tableFromIPC(r.ipc);
    expect([...t.getChild('total')!.toArray()].sort()).toEqual(['120.00', '19.99', '42.25', '5.50']);
    expect(t.getChild('notes')!.toArray().filter((x: unknown) => x !== null)).toEqual(['Gift wrap']);
    expect(t.getChild('shipping')!.toArray().filter((x: unknown) => x !== null).sort()).toEqual(['{"city":"London","postcode":"N1"}', '{"city":"New York"}']);
    expect(Array.from(t.getChild('placed_at')!.toArray(), (x) => new Date(Number(x) / 1000).toISOString()).sort()[0]).toBe('2024-04-01T09:30:00.000Z');
  });

  it('reads a query with its date as a date and its set as JSON, bounded by the limit', async () => {
    const r = await cassandraConnector('cassandra', replay()).read(ctx, { query: 'SELECT name, signed_up, active, tags FROM shop.customers', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(2);
    expect(r.columns.map((c) => c.sqlType)).toEqual(['VARCHAR', 'DATE', 'BOOLEAN', 'JSON']);
    const t = tableFromIPC(r.ipc);
    expect(Array.from({ length: t.numRows }, (_, i) => new Date(Number(t.getChild('signed_up')!.get(i))).toISOString().slice(0, 10)).every((d) => /^2024-0[1-3]-\d\d$/.test(d))).toBe(true);
    expect(t.getChild('tags')!.toArray().filter((x: unknown) => x !== null).every((x: unknown) => Array.isArray(JSON.parse(String(x))))).toBe(true);
  });

  it('reads a table with the source’s condition, scanning only when the source allows it', async () => {
    const c = cassandraConnector('cassandra', replay());
    const indexed = await c.read(ctx, { table: { schema: 'shop', name: 'orders' }, filter: "status = 'placed'", limit: 10 });
    expect('ipc' in indexed && indexed.rows).toBe(2);
    const scanned = await c.read(ctx, { table: { schema: 'shop', name: 'orders' }, filter: 'total > 10', allowFiltering: true, limit: 10 });
    expect('ipc' in scanned && scanned.rows).toBe(3);
    // Without ALLOW FILTERING the server refuses such a condition; its message is said in plain words.
    const refusing: CqlClientLike = { execute: async () => Promise.reject(new Error('Cannot execute this query as it might involve data filtering and thus may have unpredictable performance. If you want to execute this query despite the performance unpredictability, use ALLOW FILTERING')), end: async () => undefined };
    await expect(cassandraConnector('cassandra', async () => refusing).read(ctx, { table: { schema: 'shop', name: 'orders' }, filter: 'total > 10' })).rejects.toThrow('That condition isn’t on a key column, so the read would scan the table: turn on Allow filtering to let it.');
  });

  it('writes the CQL of a read: quoted names, the condition, the limit before ALLOW FILTERING, a query’s own LIMIT kept', () => {
    expect(readCql({ table: { schema: 'shop', name: 'or"ders' }, limit: 5 })).toBe('SELECT * FROM "shop"."or""ders" LIMIT 5');
    expect(readCql({ table: { name: 'orders' } }, 'shop')).toBe('SELECT * FROM "shop"."orders"');
    expect(readCql({ table: { name: 'orders' }, filter: "status = 'placed';", allowFiltering: true, limit: 3 }, 'shop')).toBe('SELECT * FROM "shop"."orders" WHERE status = \'placed\' LIMIT 3 ALLOW FILTERING');
    expect(() => readCql({ table: { name: 'orders' } })).toThrow('Give the keyspace');
    expect(() => readCql({ table: { name: 'orders' }, filter: "status = 'a'; DROP TABLE x" }, 'shop')).toThrow('without a semicolon');
    expect(() => readCql({ table: { name: 'orders' }, filter: "status = 'a' ALLOW FILTERING" }, 'shop')).toThrow('Turn on Allow filtering');
    expect(readCql({ query: 'SELECT * FROM shop.orders;', limit: 2 })).toBe('SELECT * FROM shop.orders LIMIT 2');
    expect(readCql({ query: 'SELECT * FROM shop.orders WHERE total > 1 ALLOW FILTERING', limit: 2 })).toBe('SELECT * FROM shop.orders WHERE total > 1 LIMIT 2 ALLOW FILTERING');
    expect(readCql({ query: 'SELECT * FROM shop.orders LIMIT 1', limit: 2 })).toBe('SELECT * FROM shop.orders LIMIT 1');
    expect(readCql({ query: "SELECT * FROM t WHERE x = 'limit 9'", limit: 2 })).toBe("SELECT * FROM t WHERE x = 'limit 9' LIMIT 2");
  });

  it('refuses a statement that isn’t one SELECT before it is sent', async () => {
    const c = cassandraConnector('cassandra', replay());
    await expect(c.read(ctx, { query: "UPDATE shop.orders SET status = 'x' WHERE customer_id = 1 AND id = 101" })).rejects.toThrow(/Only a .*SELECT/);
    await expect(c.read(ctx, { query: 'SELECT 1; SELECT 2' })).rejects.toThrow(/One statement/);
    await expect(c.read(ctx, {})).rejects.toThrow('Choose a table or write a query.');
  });

  it('still documents the tables where a part can’t be read, and says why when nothing can', async () => {
    const d = await cassandraConnector('cassandra', replay(/system_schema\.indexes/)).document!(ctx);
    expect(d.tables.find((t) => t.name === 'orders')!.indexes).toEqual([]);
    await expect(cassandraConnector('cassandra', replay(/system_schema\.tables/)).catalog(ctx)).rejects.toThrow('The user may not read that');
  });

  it('closes the client when a read is cancelled, even mid-connect', async () => {
    let ended = 0;
    const controller = new AbortController();
    const c = cassandraConnector('cassandra', replay(undefined, () => ended++));
    const read = c.read({ ...ctx, signal: controller.signal }, { table: { schema: 'shop', name: 'orders' }, limit: 10 });
    controller.abort();
    await expect(read).rejects.toThrow('The read was cancelled.');
    expect(ended).toBe(1);
  });

  it('keeps the keyspace to the connection’s, or every keyspace but the system ones, and orders columns by kind', () => {
    expect(inKeyspace(TABLES_CQL, "sh'op")).toBe(`${TABLES_CQL} WHERE keyspace_name = 'sh''op'`);
    expect(inKeyspace(TABLES_CQL)).toBe(TABLES_CQL);
    expect(orderedColumns([{ column_name: 'b', kind: 'regular', position: -1 }, { column_name: 'k', kind: 'clustering', position: 0 }, { column_name: 'a', kind: 'regular', position: -1 }, { column_name: 'p', kind: 'partition_key', position: 0 }]).map((c) => c.column_name)).toEqual(['p', 'k', 'a', 'b']);
    expect(indexColumn({ target: 'values(tags)' })).toBe('tags');
    expect(indexColumn({ target: 'status' })).toBe('status');
    expect(indexColumn(null)).toBe('');
  });

  it('leaves out the views ScyllaDB keeps behind its secondary indexes, keeping the ones a user made', () => {
    const views = [
      { keyspace_name: 'shop', view_name: 'orders_by_status' },
      { keyspace_name: 'shop', view_name: 'orders_status_index' },
      { keyspace_name: 'other', view_name: 'customers_email_index' },
    ];
    const indexes = [
      { keyspace_name: 'shop', table_name: 'orders', index_name: 'orders_status' },
      { keyspace_name: 'shop', table_name: 'customers', index_name: 'customers_email' },
    ];
    expect(userViews(views, indexes).map((v) => `${v.keyspace_name}.${v.view_name}`)).toEqual(['shop.orders_by_status', 'other.customers_email_index']);
    expect(userViews(views, []).length).toBe(3);
  });

  it('reads the settings and says what is missing', () => {
    expect(cassandraConfigFor(ctx)).toEqual({ host: '127.0.0.1', port: 19042, keyspace: 'shop', datacenter: 'datacenter1', password: '', ssl: false, sslVerify: true });
    expect(cassandraConfigFor({ connection: { ...connection, settings: { host: 'db', user: 'puddle', ssl: 'true', sslVerify: false } }, secret: 'pw' })).toEqual({ host: 'db', port: 9042, datacenter: 'datacenter1', user: 'puddle', password: 'pw', ssl: true, sslVerify: false });
    expect(() => cassandraConfigFor({ connection: { ...connection, settings: {} } })).toThrow('Give the database host.');
  });

  it('says what went wrong in plain words', () => {
    const config = cassandraConfigFor(ctx);
    expect(cassandraProblem(Object.assign(new Error('All host(s) tried for query failed'), { name: 'NoHostAvailableError', innerErrors: { '127.0.0.1:19042': { message: 'connect ECONNREFUSED' } } }), config).message).toBe('Nothing answers at 127.0.0.1:19042.');
    expect(cassandraProblem(Object.assign(new Error('Provided username puddle and/or password are incorrect'), { name: 'AuthenticationError' }), config).message).toBe('The database refused the user name or password.');
    expect(cassandraProblem(new Error('Unauthorized: User puddle has no SELECT permission'), config).message).toBe('The user may not read that: Unauthorized: User puddle has no SELECT permission');
    expect(cassandraProblem(new Error('localDataCenter was configured as datacenter1, but only found hosts in data centers: [dc1]'), config).message).toMatch(/^No node is in the data centre datacenter1/);
    expect(cassandraProblem(new Error('unconfigured table orders'), config).message).toBe('There is no such table: unconfigured table orders');
    expect(cassandraProblem(new ConnectorError('as is'), config).message).toBe('as is');
    expect(cassandraProblem(new Error('something else'), config).message).toBe('The database answered: something else');
  });
});
