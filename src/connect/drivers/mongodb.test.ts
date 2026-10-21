// The MongoDB driver against the calls recorded from a MongoDB-compatible server (tests/fixtures/db/mongodb/,
// regenerated with scripts/record-database.mjs mongodb <url>; the order_totals view was added to the recording by
// hand in the shapes a MongoDB answers with, since the FerretDB it was recorded from has no views), and against a
// server that refuses a part.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { replayClient } from '../../../tests/helpers/replayCalls';
import type { Connection } from '../../model';
import { ConnectorError, type CatalogDetail } from '../types';
import { mongoConfigFor, mongoConnector, mongoProblem, parseDocument, parseShellQuery, plainBson, shellJson, type MongoClientLike } from './mongodb';

const recorded = JSON.parse(readFileSync(join(__dirname, '../../../tests/fixtures/db/mongodb/catalog.json'), 'utf8')) as { test: unknown; catalog: unknown; detail: CatalogDetail };

const replay = (refuse?: RegExp, onEnd?: () => void) => async () => replayClient<MongoClientLike>('mongodb', { refuse: (method) => (refuse?.test(method) ? Object.assign(new Error('not authorized on shop to execute command'), { code: 13, codeName: 'Unauthorized' }) : undefined), onEnd });

const connection: Connection = { id: 'c', name: 'shop', driver: 'mongodb', via: 'local', settings: { url: 'mongodb://127.0.0.1:27018', database: 'shop' }, auth: 'password' };
const ctx = { connection, secret: '' };
/** The inferred notes carry the day they were made; the recording's day stands in for today's. */
const dated = (d: CatalogDetail) => ({ ...d, tables: d.tables.map((t) => ({ ...t, note: t.note?.replace(/\d{4}-\d{2}-\d{2}$/, 'DATE') })) });

describe('the MongoDB driver', () => {
  it('tests, catalogues and documents the shop as recorded: columns from the documents, _id the key, the indexes, the view’s pipeline', async () => {
    const c = mongoConnector(replay());
    expect(await c.test(ctx)).toEqual(recorded.test);
    expect(await c.catalog(ctx)).toEqual(recorded.catalog);
    expect(dated(await c.document!(ctx))).toEqual(dated(recorded.detail));
    const orders = recorded.detail.tables.find((t) => t.name === 'orders')!;
    expect(orders.columns.find((x) => x.name === '_id')).toMatchObject({ pk: true, unique: true, notNull: true });
    expect(orders.columns.find((x) => x.name === 'shipping.city')).toMatchObject({ type: 'string', notNull: false, note: 'present in 50% of documents' });
    expect(orders.columns.find((x) => x.name === 'tags')).toMatchObject({ type: 'array' });
    expect(orders.indexes).toEqual([{ name: 'orders_customer', columns: ['customer_id', 'placed_at'], unique: false }]);
    expect(recorded.detail.tables.find((t) => t.name === 'customers')!.indexes).toEqual([{ name: 'customers_email', columns: ['email'], unique: true }]);
    const view = recorded.detail.tables.find((t) => t.name === 'order_totals')!;
    expect(view.kind).toBe('view');
    expect(view.note).toMatch(/^A view on orders\. Inferred from 4 documents on /);
    expect(view.sql).toContain('"$lookup"');
  });

  it('reads a collection as an Arrow stream: nested documents flattened, the array as JSON, dates as timestamps, the null kept', async () => {
    const r = await mongoConnector(replay()).read(ctx, { table: { name: 'orders' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(r.columns).toEqual([
      { name: '_id', sqlType: 'BIGINT' },
      { name: 'customer_id', sqlType: 'BIGINT' },
      { name: 'total', sqlType: 'DOUBLE' },
      { name: 'placed_at', sqlType: 'TIMESTAMP' },
      { name: 'status', sqlType: 'VARCHAR' },
      { name: 'notes', sqlType: 'VARCHAR' },
      { name: 'tags', sqlType: 'JSON' },
      { name: 'shipping.city', sqlType: 'VARCHAR' },
      { name: 'shipping.postcode', sqlType: 'VARCHAR' },
    ]);
    const t = tableFromIPC(r.ipc);
    expect(Array.from(t.getChild('_id')!.toArray(), Number)).toEqual([101, 102, 103, 104]);
    expect(t.getChild('tags')!.toArray()).toEqual(['["gift","express"]', '[]', '["bulk"]', '[]']);
    expect(t.getChild('shipping.city')!.toArray()).toEqual(['London', null, 'New York', null]);
    expect(t.getChild('notes')!.toArray()).toEqual(['Gift wrap', null, null, null]);
    expect(new Date(Number(t.getChild('placed_at')!.get(0))).toISOString()).toBe('2024-04-01T09:30:00.000Z');
  });

  it('reads a collection with the source’s filter, and with arrays as rows when the source asks', async () => {
    const c = mongoConnector(replay());
    const placed = await c.read(ctx, { table: { name: 'orders' }, filter: '{ "status": "placed" }', limit: 10 });
    if (!('ipc' in placed)) throw new Error('expected a stream');
    expect(placed.rows).toBe(2);
    expect(Array.from(tableFromIPC(placed.ipc).getChild('_id')!.toArray(), Number)).toEqual([102, 104]);
    const rows = await c.read(ctx, { table: { name: 'orders' }, limit: 10, shape: { arrays: 'rows', depth: 1 } });
    if (!('ipc' in rows)) throw new Error('expected a stream');
    expect(rows.rows).toBe(5);
    const t = tableFromIPC(rows.ipc);
    expect(rows.columns.map((x) => x.name)).toEqual(['_id', 'customer_id', 'total', 'placed_at', 'status', 'notes', 'tags', 'shipping']);
    expect(t.getChild('tags')!.toArray()).toEqual(['gift', 'express', null, 'bulk', null]);
    expect(rows.columns.find((x) => x.name === 'shipping')!.sqlType).toBe('JSON');
    await expect(c.read(ctx, { table: { name: 'orders' }, filter: '{ status: }' })).rejects.toThrow(/^The filter isn’t JSON/);
    await expect(c.read(ctx, { table: { name: 'orders' }, filter: '[1]' })).rejects.toThrow('The filter must be a JSON object');
  });

  it('reads a shell query: find with a projection, and an aggregation', async () => {
    const c = mongoConnector(replay());
    const found = await c.read(ctx, { query: 'db.orders.find({ customer_id: 1 }, { _id: 1, total: 1, status: 1 })', limit: 2 });
    if (!('ipc' in found)) throw new Error('expected a stream');
    expect(found.columns.map((x) => x.name)).toEqual(['_id', 'total', 'status']);
    expect(found.rows).toBe(2);
    const grouped = await c.read(ctx, { query: 'db.orders.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }, { $sort: { _id: 1 } }])', limit: 10 });
    if (!('ipc' in grouped)) throw new Error('expected a stream');
    const t = tableFromIPC(grouped.ipc);
    expect(t.getChild('_id')!.toArray()).toEqual(['placed', 'returned', 'shipped']);
    expect(Array.from(t.getChild('n')!.toArray(), Number)).toEqual([2, 1, 1]);
    expect(grouped.columns.map((x) => x.sqlType)).toEqual(['VARCHAR', 'BIGINT']);
  });

  it('refuses a query that writes or isn’t a shell call before it is sent', async () => {
    const c = mongoConnector(replay());
    await expect(c.read(ctx, { query: 'db.orders.aggregate([{ $match: {} }, { $out: "copy" }])' })).rejects.toThrow('A pipeline with $out writes; the connection only reads.');
    await expect(c.read(ctx, { query: 'db.orders.deleteMany({})' })).rejects.toThrow(/^Write the query as the shell takes it/);
    await expect(c.read(ctx, { query: 'db.orders.find(1)' })).rejects.toThrow('find() takes a filter document');
    await expect(c.read(ctx, { query: 'db.orders.aggregate({})' })).rejects.toThrow('aggregate() takes a pipeline');
    await expect(c.read(ctx, {})).rejects.toThrow('Choose a collection or write a query.');
  });

  it('reads the shell’s JSON: unquoted keys, single quotes, Extended JSON, getCollection', () => {
    expect(shellJson("{ status: 'placed', n: 1, 'it\\'s': \"a\\\"b\", $gt: {x: [1, 'y']} }")).toBe('{ "status": "placed", "n": 1, "it\'s": "a\\"b", "$gt": {"x": [1, "y"]} }');
    expect(shellJson('{"a":1}')).toBe('{"a":1}');
    expect(shellJson("{ s: 'say \"hi\"' }")).toBe('{ "s": "say \\"hi\\"" }');
    expect(parseDocument('{ _id: { $oid: "507f1f77bcf86cd799439011" }, at: { $date: "2024-01-01T00:00:00Z" } }', 'filter')).toMatchObject({ at: new Date('2024-01-01T00:00:00Z') });
    expect(String((parseDocument('{ _id: { $oid: "507f1f77bcf86cd799439011" } }', 'filter') as { _id: unknown })._id)).toBe('507f1f77bcf86cd799439011');
    expect(parseShellQuery('db.getCollection("my-orders").find()')).toEqual({ collection: 'my-orders', find: {} });
    expect(parseShellQuery(' db.orders.aggregate([{ $limit: 1 }]); ')).toEqual({ collection: 'orders', pipeline: [{ $limit: 1 }] });
    expect(() => parseDocument('nope', 'filter')).toThrow(/^The filter isn’t JSON/);
    expect(() => parseDocument('"x"', 'filter')).toThrow('must be a JSON object');
  });

  it('makes BSON values plain: ids and decimals as text, longs as numbers where safe, binary as bytes, UUIDs as text', () => {
    expect(plainBson({ _bsontype: 'ObjectId', toHexString: () => '507f1f77bcf86cd799439011' })).toBe('507f1f77bcf86cd799439011');
    expect(plainBson({ _bsontype: 'Decimal128', toString: () => '19.99' })).toBe('19.99');
    expect(plainBson({ _bsontype: 'Long', toString: () => '42' })).toBe(42);
    expect(plainBson({ _bsontype: 'Long', toString: () => '9007199254740993' })).toBe('9007199254740993');
    expect(plainBson({ _bsontype: 'Int32', value: 7 })).toBe(7);
    expect(plainBson({ _bsontype: 'Binary', sub_type: 0, buffer: new Uint8Array([1, 2]) })).toEqual(new Uint8Array([1, 2]));
    expect(plainBson({ _bsontype: 'Binary', sub_type: 4, buffer: new Uint8Array(16), toUUID: () => ({ toString: () => '00000000-0000-0000-0000-000000000000' }) })).toBe('00000000-0000-0000-0000-000000000000');
    expect(plainBson({ _bsontype: 'BSONRegExp', pattern: 'a.*', options: 'i' })).toBe('/a.*/i');
    expect(plainBson({ _bsontype: 'DBRef', collection: 'customers', oid: { _bsontype: 'ObjectId', toHexString: () => 'abc' } })).toEqual({ collection: 'customers', id: 'abc' });
    const d = new Date();
    expect(plainBson({ a: [1, { b: d }], n: null })).toEqual({ a: [1, { b: d }], n: null });
    expect(plainBson(undefined)).toBeNull();
  });

  it('still documents the collections where a part can’t be read, and says why when nothing can', async () => {
    const d = await mongoConnector(replay(/^indexes$/)).document!(ctx);
    expect(d.tables.find((t) => t.name === 'orders')!.indexes).toEqual([]);
    await expect(mongoConnector(replay(/^collections$/)).catalog(ctx)).rejects.toThrow('The user may not read that');
  });

  it('closes the client when a read is cancelled', async () => {
    let ended = 0;
    const controller = new AbortController();
    const c = mongoConnector(replay(undefined, () => ended++));
    const read = c.read({ ...ctx, signal: controller.signal }, { table: { name: 'orders' }, limit: 10 });
    controller.abort();
    await expect(read).rejects.toThrow('The read was cancelled.');
    expect(ended).toBe(1);
  });

  it('reads the settings and says what is missing or misplaced', () => {
    expect(mongoConfigFor({ connection: { ...connection, settings: { url: 'mongodb+srv://cluster0.example.net', database: 'shop', user: 'puddle', authSource: 'admin', depth: 3 } }, secret: 'pw' })).toEqual({ url: 'mongodb+srv://cluster0.example.net', database: 'shop', user: 'puddle', password: 'pw', authSource: 'admin', depth: 3 });
    expect(mongoConfigFor(ctx)).toEqual({ url: 'mongodb://127.0.0.1:27018', database: 'shop', password: '', depth: 2 });
    expect(() => mongoConfigFor({ connection: { ...connection, settings: { url: 'http://x', database: 'shop' } } })).toThrow('Give the address as mongodb://');
    expect(() => mongoConfigFor({ connection: { ...connection, settings: { url: 'mongodb://u:pw@x', database: 'shop' } } })).toThrow('Put the password in the secret, not in the address.');
    expect(() => mongoConfigFor({ connection: { ...connection, settings: { url: 'mongodb://x' } } })).toThrow('Give the database.');
  });

  it('says what went wrong in plain words', () => {
    const config = mongoConfigFor(ctx);
    expect(mongoProblem(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:27018'), { name: 'MongoServerSelectionError' }), config).message).toBe('Nothing answers at 127.0.0.1:27018.');
    expect(mongoProblem(Object.assign(new Error('Authentication failed.'), { code: 18, codeName: 'AuthenticationFailed' }), config).message).toBe('The database refused the user name or password.');
    expect(mongoProblem(Object.assign(new Error('not authorized on shop to execute command { find: "orders" }'), { code: 13 }), config).message).toBe('The user may not read that: not authorized on shop to execute command { find: "orders" }');
    expect(mongoProblem(Object.assign(new Error('ns not found'), { code: 26 }), config).message).toBe('There is no such collection in the database.');
    expect(mongoProblem(new Error('self signed certificate'), config).message).toBe('127.0.0.1:27018’s certificate isn’t trusted.');
    expect(mongoProblem(new ConnectorError('as is'), config).message).toBe('as is');
    expect(mongoProblem(new Error('something else'), config).message).toBe('MongoDB answered: something else');
  });
});
