// The SurrealDB driver against the exchanges recorded from a SurrealDB server (tests/fixtures/db/surrealdb/,
// regenerated with scripts/record-database.mjs surrealdb <url>), and against a server that refuses a part.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exchangesFor, replayFetch } from '../../../tests/helpers/replayFetch';
import type { Connection } from '../../model';
import { ConnectorError, type CatalogDetail } from '../types';
import { declaredDuckType, ident, parseFields, parseIndexes, queryProblem, readSql, recordTarget, requestHeaders, surrealConfigFor, surrealConnector, surrealProblem, tableNote } from './surrealdb';

const recorded = JSON.parse(readFileSync(join(__dirname, '../../../tests/fixtures/db/surrealdb/catalog.json'), 'utf8')) as { test: unknown; catalog: unknown; detail: CatalogDetail };

const connection: Connection = { id: 'c', name: 'shop', driver: 'surrealdb', via: 'browser', settings: { url: 'http://127.0.0.1:18000', namespace: 'shop', database: 'shop', user: 'root', level: 'root' }, auth: 'password' };
const ctx = { connection, secret: 'root' };
/** The inferred notes carry the day they were made; the recording's day stands in for today's. */
const dated = (d: CatalogDetail) => ({ ...d, tables: d.tables.map((t) => ({ ...t, note: t.note?.replace(/\d{4}-\d{2}-\d{2}$/, 'DATE') })) });

describe('the SurrealDB driver', () => {
  it('tests, catalogues and documents the shop as recorded: declared fields on top of what the records show', async () => {
    const c = surrealConnector(replayFetch('surrealdb'));
    expect(await c.test(ctx)).toEqual(recorded.test);
    expect(await c.catalog(ctx)).toEqual(recorded.catalog);
    expect(dated(await c.document!(ctx))).toEqual(dated(recorded.detail));
    const orders = recorded.detail.tables.find((t) => t.name === 'orders')!;
    expect(orders.foreignKeys).toEqual([{ columns: ['customer'], refTable: 'customers', refColumns: ['id'] }]);
    expect(orders.columns.find((x) => x.name === 'shipping.city')).toMatchObject({ type: 'string', notNull: false, note: 'present in 50% of documents' });
    const customers = recorded.detail.tables.find((t) => t.name === 'customers')!;
    expect(customers.note).toMatch(/^People who have ordered\. Inferred from 3 documents on /);
    expect(customers.columns.find((x) => x.name === 'email')).toMatchObject({ type: 'option<string>', unique: true, notNull: false, note: 'Lower case' });
    expect(customers.columns.find((x) => x.name === 'active')).toMatchObject({ type: 'bool', default: 'true', notNull: true });
  });

  it('reads a table as an Arrow stream: nested objects flattened, arrays as JSON text, a declared datetime as a timestamp and a decimal kept exact', async () => {
    const c = surrealConnector(replayFetch('surrealdb'));
    const r = await c.read(ctx, { table: { name: 'orders' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(r.columns).toEqual([
      { name: 'customer', sqlType: 'VARCHAR' },
      { name: 'id', sqlType: 'VARCHAR' },
      { name: 'notes', sqlType: 'VARCHAR' },
      { name: 'placed_at', sqlType: 'TIMESTAMP' },
      { name: 'shipping.city', sqlType: 'VARCHAR' },
      { name: 'shipping.postcode', sqlType: 'VARCHAR' },
      { name: 'status', sqlType: 'VARCHAR' },
      { name: 'tags', sqlType: 'JSON' },
      { name: 'total', sqlType: 'DECIMAL(38,9)' },
    ]);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('total')!.toArray()).toEqual(['19.99', '5.5', '120', '42.25']);
    expect(t.getChild('tags')!.toArray()).toEqual(['["gift","express"]', '[]', '["bulk"]', '[]']);
    expect(t.getChild('shipping.city')!.toArray()).toEqual(['London', null, 'New York', null]);
    expect(t.getChild('customer')!.toArray()).toEqual(['customers:1', 'customers:1', 'customers:2', 'customers:3']);
    expect(Number(t.getChild('placed_at')!.get(0))).toBe(Date.parse('2024-04-01T09:30:00Z'));
  });

  it('reads a query through a record link, bounded by a LIMIT around it, typed from the values', async () => {
    const c = surrealConnector(replayFetch('surrealdb'));
    const r = await c.read(ctx, { query: 'SELECT customer.name AS name, total, placed_at, status, customer.signed_up AS signed_up, customer.active AS active, id FROM orders ORDER BY id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(2);
    expect(r.columns.map((x) => [x.name, x.sqlType])).toEqual([
      ['active', 'BOOLEAN'],
      ['id', 'VARCHAR'],
      ['name', 'VARCHAR'],
      ['placed_at', 'VARCHAR'],
      ['signed_up', 'VARCHAR'],
      ['status', 'VARCHAR'],
      ['total', 'VARCHAR'],
    ]);
    expect(tableFromIPC(r.ipc).getChild('name')!.toArray()).toEqual(['Ada Lovelace', 'Ada Lovelace']);
  });

  it('refuses a query that writes before sending it, even inside a SELECT', async () => {
    const f = replayFetch('surrealdb');
    const c = surrealConnector(f);
    await expect(c.read(ctx, { query: "UPDATE orders:101 SET status = 'x'" })).rejects.toThrow('Only a query that reads can run here (SELECT, RETURN, INFO or SHOW), not UPDATE.');
    await expect(c.read(ctx, { query: 'SELECT * FROM (CREATE scratch:1 SET a = 1)' })).rejects.toThrow(/writes, creates or changes/);
    await expect(c.read(ctx, { query: 'SELECT * FROM orders; REMOVE TABLE orders' })).rejects.toThrow(/One statement at a time/);
    await expect(c.read(ctx, {})).rejects.toThrow('Choose a table or write a query.');
    expect(f.calls.length).toBe(0);
    expect(queryProblem("SELECT * FROM orders WHERE status = 'delete me'")).toBeUndefined();
    expect(queryProblem('INFO FOR DB')).toBeUndefined();
    expect(queryProblem('  ')).toBe('The query is empty.');
  });

  it('says a failure in plain words, and the server’s own errors as they are', async () => {
    const config = surrealConfigFor(ctx);
    expect(surrealProblem(401, 'There was a problem with the database: The password did not verify', config).message).toBe('127.0.0.1:18000 refused the user name or password.');
    expect(surrealProblem(401, '', { ...config, level: 'database' }).message).toBe('127.0.0.1:18000 refused the user name or password (as a database user).');
    expect(surrealProblem(404, '', config).message).toBe('Nothing at 127.0.0.1:18000 answers as a SurrealDB server.');
    expect(surrealProblem(400, JSON.stringify({ code: 400, information: 'There was a problem with the database: Parse error: Unexpected end of file\n --> [1:11]' }), config).message).toBe('The database answered: Parse error: Unexpected end of file');
    const refused = surrealConnector(replayFetch('surrealdb', { test: (b) => b.includes('/sql'), status: 401, response: 'There was a problem with authentication' }));
    expect(await refused.test(ctx)).toEqual({ ok: false, reason: '127.0.0.1:18000 refused the user name or password.' });
    const erring = surrealConnector(replayFetch('surrealdb', { test: (b) => b.includes('nothing_here'), status: 200, response: JSON.stringify([{ status: 'ERR', result: 'The table nothing_here does not exist', time: '1µs' }]) }));
    await expect(erring.read(ctx, { table: { name: 'nothing_here' } })).rejects.toThrow('The database answered: The table nothing_here does not exist');
    const notSurreal = surrealConnector(replayFetch('surrealdb', { test: () => true, status: 200, response: '<html>' }));
    await expect(notSurreal.catalog(ctx)).rejects.toThrow('Nothing at 127.0.0.1:18000 answers as a SurrealDB server.');
  });

  it('turns the settings into a config and headers for the user’s level, and parses what INFO FOR TABLE defines', () => {
    expect(surrealConfigFor(ctx)).toEqual({ url: 'http://127.0.0.1:18000', namespace: 'shop', database: 'shop', user: 'root', password: 'root', level: 'root', depth: 2 });
    expect(() => surrealConfigFor({ connection: { ...connection, settings: { url: 'http://x' } } })).toThrow('Give the namespace.');
    expect(() => surrealConfigFor({ connection: { ...connection, settings: { url: 'http://x', namespace: 'n' } } })).toThrow('Give the database.');
    expect(() => surrealConfigFor({ connection: { ...connection, settings: { url: 'http://x', namespace: 'n', database: 'd' } } })).toThrow('Give the user name.');
    expect(() => surrealConfigFor({ connection: { ...connection, settings: { ...connection.settings, level: 'owner' } } })).toThrow('The user level should be root, namespace or database.');
    expect(surrealConfigFor({ connection: { ...connection, settings: { ...connection.settings, depth: 3 } } }).depth).toBe(3);
    const headers = requestHeaders({ ...surrealConfigFor(ctx), level: 'database' });
    expect(headers).toMatchObject({ 'surreal-ns': 'shop', 'surreal-db': 'shop', 'surreal-auth-ns': 'shop', 'surreal-auth-db': 'shop', Authorization: `Basic ${btoa('root:root')}` });
    expect(requestHeaders(surrealConfigFor(ctx))).not.toHaveProperty('surreal-auth-ns');
    expect(requestHeaders({ ...surrealConfigFor(ctx), level: 'namespace' })).not.toHaveProperty('surreal-auth-db');
    expect(parseFields({ email: "DEFINE FIELD email ON customers TYPE option<string> COMMENT 'Lower case' PERMISSIONS FULL", active: 'DEFINE FIELD active ON customers TYPE bool DEFAULT true PERMISSIONS FULL', any: 'DEFINE FIELD any ON t PERMISSIONS FULL' })).toEqual([
      { name: 'email', type: 'option<string>', note: 'Lower case' },
      { name: 'active', type: 'bool', default: 'true' },
      { name: 'any' },
    ]);
    expect(parseIndexes({ customers_email: 'DEFINE INDEX customers_email ON customers FIELDS email UNIQUE', by_two: 'DEFINE INDEX by_two ON t FIELDS a, b' })).toEqual([
      { name: 'customers_email', columns: ['email'], unique: true },
      { name: 'by_two', columns: ['a', 'b'], unique: false },
    ]);
    expect(tableNote("DEFINE TABLE customers TYPE NORMAL SCHEMAFULL COMMENT 'People who have ordered' PERMISSIONS NONE")).toBe('People who have ordered');
    expect(tableNote('DEFINE TABLE orders TYPE ANY SCHEMALESS PERMISSIONS NONE')).toBeUndefined();
    expect(['int', 'float', 'decimal', 'bool', 'datetime', 'option<array<string>>', 'string', 'record<customers>', 'any', undefined].map(declaredDuckType)).toEqual(['BIGINT', 'DOUBLE', 'DECIMAL(38,9)', 'BOOLEAN', 'TIMESTAMP', 'JSON', 'VARCHAR', 'VARCHAR', undefined, undefined]);
    expect(recordTarget('option<record<customers>>')).toBe('customers');
    expect(recordTarget('string')).toBeUndefined();
    expect(ident('a`b')).toBe('`a\\`b`');
    expect(readSql({ table: { name: 'orders' }, limit: 5 })).toBe('SELECT * FROM `orders` LIMIT 5');
    expect(readSql({ query: 'SELECT * FROM orders; ', limit: 2 })).toBe('SELECT * FROM (SELECT * FROM orders) LIMIT 2');
    expect(exchangesFor('surrealdb').every((e) => !/root|Basic /.test(`${e.url}${e.body ?? ''}`))).toBe(true);
    expect(new ConnectorError('x')).toBeInstanceOf(Error);
  });
});
