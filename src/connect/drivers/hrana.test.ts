// The LibSQL (Hrana) driver against the exchanges recorded from a LibSQL server (tests/fixtures/db/libsql/,
// regenerated with scripts/record-database.mjs libsql <url>), and against a server that refuses the token.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exchangesFor, replayFetch } from '../../../tests/helpers/replayFetch';
import type { Connection } from '../../model';
import { ConnectorError } from '../types';
import { hranaConfigFor, hranaConnector, hranaProblem, plainValue, readSql, sheetFromResult } from './hrana';
import { libsqlConnector } from './libsql';

const recorded = JSON.parse(readFileSync(join(__dirname, '../../../tests/fixtures/db/libsql/catalog.json'), 'utf8')) as { test: unknown; catalog: unknown; detail: unknown };

const connection: Connection = { id: 'c', name: 'shop', driver: 'libsql', via: 'browser', settings: { url: 'http://127.0.0.1:18081' }, auth: 'token' };
const ctx = { connection, secret: 'puddle-token' };

describe('the LibSQL driver', () => {
  it('tests, catalogues and documents the shop as recorded', async () => {
    const c = hranaConnector('libsql', replayFetch('libsql'));
    expect(await c.test(ctx)).toEqual(recorded.test);
    expect(await c.catalog(ctx)).toEqual(recorded.catalog);
    expect(await c.document!(ctx)).toEqual(recorded.detail);
  });

  it('reads a table as an Arrow stream typed by the declared columns, inside a transaction that is rolled back', async () => {
    const f = replayFetch('libsql');
    const r = await hranaConnector('libsql', f).read(ctx, { table: { name: 'orders' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(r.columns).toEqual([
      { name: 'id', sqlType: 'BIGINT' },
      { name: 'customer_id', sqlType: 'BIGINT' },
      { name: 'total', sqlType: 'DECIMAL(10,2)' },
      { name: 'placed_at', sqlType: 'VARCHAR' },
      { name: 'status', sqlType: 'VARCHAR' },
      { name: 'notes', sqlType: 'VARCHAR' },
      { name: 'tags', sqlType: 'VARCHAR' },
    ]);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('total')!.toArray()).toEqual(['19.99', '5.5', '120', '42.25']);
    expect(t.getChild('notes')!.toArray()).toEqual(['Gift wrap', null, null, null]);
    const pipelines = f.calls.filter((c) => c.body).map((c) => (JSON.parse(c.body!) as { requests: { type: string; stmt?: { sql: string } }[] }).requests.map((q) => q.stmt?.sql ?? q.type));
    expect(pipelines).toContainEqual(['BEGIN', 'SELECT * FROM "orders" LIMIT 10', 'ROLLBACK', 'close']);
  });

  it('reads a query typed by the columns’ declared types where the server gives them, bounded by a LIMIT around it', async () => {
    const r = await hranaConnector('libsql', replayFetch('libsql')).read(ctx, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(2);
    expect(r.columns.map((c) => c.sqlType)).toEqual(['VARCHAR', 'DECIMAL(10,2)', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'BOOLEAN']);
    expect(tableFromIPC(r.ipc).getChild('name')!.toArray()).toEqual(['Ada Lovelace', 'Ada Lovelace']);
  });

  it('refuses a statement that writes before sending it, and says a refused token in plain words', async () => {
    const f = replayFetch('libsql');
    const c = hranaConnector('libsql', f);
    await expect(c.read(ctx, { query: "UPDATE orders SET status = 'x'" })).rejects.toThrow(/Only a query that reads/);
    expect(f.calls.length).toBe(0);
    await expect(c.read(ctx, {})).rejects.toThrow('Choose a table or write a query.');
    const refused = hranaConnector('libsql', replayFetch('libsql', { test: () => true, status: 401, response: '{"error":"Unauthorized: `The JWT is invalid`"}' }));
    expect(await refused.test(ctx)).toEqual({ ok: false, reason: '127.0.0.1:18081 refused the token.' });
    expect(hranaProblem(401, '', { url: 'http://x' })).toEqual(new ConnectorError('x needs a token.'));
    expect(hranaProblem(404, 'nope', { url: 'http://x' }).message).toBe('Nothing at x answers as a LibSQL server.');
    expect(hranaProblem(500, '{"error":{"message":"no such table: y"}}', { url: 'http://x' }).message).toBe('The database answered: no such table: y');
    const failing = hranaConnector('libsql', replayFetch('libsql', { test: (b) => b.includes('no_such'), status: 200, response: JSON.stringify({ results: [{ type: 'ok', response: { type: 'execute', result: { cols: [], rows: [] } } }, { type: 'error', error: { message: 'no such table: no_such' } }] }) }));
    await expect(failing.read(ctx, { table: { name: 'no_such' } })).rejects.toThrow('The database answered: no such table: no_such');
  });

  it('turns the settings into a config, a libsql:// address reached over https, and values into plain ones', () => {
    expect(hranaConfigFor({ connection: { ...connection, settings: { url: 'libsql://shop-kev.turso.io/' } }, secret: 't' })).toEqual({ url: 'https://shop-kev.turso.io', token: 't' });
    expect(hranaConfigFor({ connection: { ...connection, settings: { url: 'http://127.0.0.1:8080' } } })).toEqual({ url: 'http://127.0.0.1:8080' });
    expect(() => hranaConfigFor({ connection: { ...connection, settings: {} } })).toThrow('Give the address.');
    expect(plainValue({ type: 'integer', value: '42' })).toBe(42);
    expect(plainValue({ type: 'integer', value: '9007199254740993' })).toBe('9007199254740993');
    expect(plainValue({ type: 'float', value: 1.5 })).toBe(1.5);
    expect(plainValue({ type: 'blob', base64: 'AQI=' })).toEqual(new Uint8Array([1, 2]));
    expect(plainValue({ type: 'null' })).toBeNull();
    expect(readSql({ table: { name: 'a"b' }, limit: 3 })).toBe('SELECT * FROM "a""b" LIMIT 3');
    expect(readSql({ query: 'SELECT 1 AS n; ' })).toBe('SELECT 1 AS n');
    const s = sheetFromResult({ cols: [{ name: 'n', decltype: null }, { name: null, decltype: 'BOOLEAN' }], rows: [[{ type: 'integer', value: '1' }, { type: 'integer', value: '1' }], [{ type: 'float', value: 2.5 }, { type: 'null' }]], affected_row_count: 0 });
    expect(s.columns.map((c) => [c.name, c.type, c.values])).toEqual([['n', 'DOUBLE', [1, 2.5]], ['column1', 'BOOLEAN', [true, null]]]);
    expect(exchangesFor('libsql').every((e) => !e.url.includes('token') && !(e.body ?? '').includes('token'))).toBe(true);
  });

  it('routes a connection with an address to the server and one without to the file reader', async () => {
    const calls: string[] = [];
    const fake = (name: string) => ({ id: 'libsql' as const, runsIn: ['browser' as const], test: async () => (calls.push(name), { ok: true as const, server: name }), catalog: async () => ({ tables: [] }), read: async () => ({ ipc: new Uint8Array(), columns: [], rows: 0 }), document: async () => ({ tables: [], enums: [] }) });
    const c = libsqlConnector(fake('file'), fake('http'));
    await c.test({ connection: { ...connection, settings: { url: 'libsql://x' } } });
    await c.test({ connection: { ...connection, settings: {} } });
    await c.catalog({ connection: { ...connection, settings: { url: ' ' } } });
    await c.document!({ connection: { ...connection, settings: { url: 'http://x' } } });
    expect(calls).toEqual(['http', 'file']);
  });
});
