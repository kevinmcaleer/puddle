// The ClickHouse driver against the exchanges recorded from a ClickHouse engine (tests/fixtures/db/clickhouse/,
// regenerated with scripts/record-database.mjs clickhouse <url>), and against a server that refuses a part.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Connection } from '../../model';
import { replayFetch } from '../../../tests/helpers/replayFetch';
import { ConnectorError } from '../types';
import { clickhouseConfigFor, clickhouseConnector, clickhouseDefault, clickhouseProblem, queryUrl, readSql } from './clickhouse';

const recorded = JSON.parse(readFileSync(join(__dirname, '../../../tests/fixtures/db/clickhouse/catalog.json'), 'utf8')) as { test: unknown; catalog: unknown; detail: unknown };

const connection: Connection = { id: 'c', name: 'shop', driver: 'clickhouse', via: 'browser', settings: { url: 'http://127.0.0.1:18123', database: 'shop', user: 'default' }, auth: 'password' };
const ctx = { connection, secret: 'puddle' };

describe('the ClickHouse driver', () => {
  it('tests, catalogues and documents the shop as recorded', async () => {
    const c = clickhouseConnector(replayFetch('clickhouse'));
    expect(await c.test(ctx)).toEqual(recorded.test);
    expect(await c.catalog(ctx)).toEqual(recorded.catalog);
    expect(await c.document!(ctx)).toEqual(recorded.detail);
  });

  it('reads a table as an Arrow stream with the loader’s types, the array as JSON text', async () => {
    const c = clickhouseConnector(replayFetch('clickhouse'));
    const r = await c.read(ctx, { table: { name: 'orders' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(r.columns).toEqual([
      { name: 'id', sqlType: 'BIGINT' },
      { name: 'customer_id', sqlType: 'BIGINT' },
      { name: 'total', sqlType: 'DECIMAL(10,2)' },
      { name: 'placed_at', sqlType: 'TIMESTAMP' },
      { name: 'status', sqlType: 'VARCHAR' },
      { name: 'notes', sqlType: 'VARCHAR' },
      { name: 'tags', sqlType: 'JSON' },
    ]);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('total')!.toArray()).toEqual(['19.99', '5.5', '120', '42.25']);
    expect(t.getChild('tags')!.toArray()).toEqual(['["gift","express"]', '[]', '["bulk"]', '[]']);
    expect(t.getChild('notes')!.toArray()).toEqual(['Gift wrap', null, null, null]);
    expect(Number(t.getChild('placed_at')!.get(0))).toBe(Date.UTC(2024, 3, 1, 9, 30));
  });

  it('reads a query as a subquery, typed from the result, with a date and a boolean', async () => {
    const c = clickhouseConnector(replayFetch('clickhouse'));
    const r = await c.read(ctx, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(2);
    expect(r.columns.map((x) => x.sqlType)).toEqual(['VARCHAR', 'DECIMAL(10,2)', 'TIMESTAMP', 'VARCHAR', 'DATE', 'BOOLEAN']);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('active')!.get(0)).toBe(true);
    expect(Number(t.getChild('signed_up')!.get(0))).toBe(Date.UTC(2024, 0, 15));
  });

  it('still documents the tables where the skipping indexes can’t be read, and says when the server refuses', async () => {
    const c = clickhouseConnector(replayFetch('clickhouse', { test: (x) => /data_skipping_indices/.test(x), status: 500, response: 'Code: 497. DB::Exception: default: Not enough privileges. (ACCESS_DENIED)' }));
    const d = await c.document!(ctx);
    expect(d.tables.map((t) => t.name)).toEqual(['customers', 'order_totals', 'orders']);
    expect(d.tables[2]!.indexes).toEqual([]);
    const refused = clickhouseConnector(replayFetch('clickhouse', { test: () => true, status: 403, response: 'Code: 516. DB::Exception: default: Authentication failed: password is incorrect, or there is no user with such name. (AUTHENTICATION_FAILED)' }));
    await expect(refused.test(ctx)).rejects.toThrow('The database refused the user name or password.');
  });

  it('needs an address, and puts the settings in the query address without headers', () => {
    expect(() => clickhouseConfigFor({ connection: { ...connection, settings: {} } })).toThrow(ConnectorError);
    expect(() => clickhouseConfigFor({ connection: { ...connection, settings: { url: 'localhost:8123' } } })).toThrow(/http/);
    const config = clickhouseConfigFor({ connection: { ...connection, settings: { url: 'https://ch.example.com:8443/', database: '', user: '' } }, secret: 'pw' });
    expect(config).toEqual({ url: 'https://ch.example.com:8443', database: 'default', user: 'default', password: 'pw' });
    const u = new URL(queryUrl(config));
    expect(u.origin + u.pathname).toBe('https://ch.example.com:8443/');
    expect(u.searchParams.get('password')).toBe('pw');
    expect(u.searchParams.get('default_format')).toBe('JSONCompact');
    expect(u.searchParams.get('readonly')).toBe('2');
    expect(u.searchParams.get('add_http_cors_header')).toBe('1');
  });

  it('says a failure in plain words without the password', () => {
    const config = clickhouseConfigFor(ctx);
    expect(clickhouseProblem(403, 'Code: 516. DB::Exception: default: Authentication failed: password is incorrect, or there is no user with such name. (AUTHENTICATION_FAILED) (version 24.3.2.23 (official build))', config).message).toBe('The database refused the user name or password.');
    expect(clickhouseProblem(404, "Code: 81. DB::Exception: Database shop doesn't exist. (UNKNOWN_DATABASE) (version 24.3.2.23)", config).message).toBe('There is no database called shop at 127.0.0.1:18123.');
    expect(clickhouseProblem(500, 'Code: 164. DB::Exception: default: Cannot execute query in readonly mode. (READONLY)', config).message).toBe('The connection is read-only, so that statement can’t run.');
    expect(clickhouseProblem(400, "Code: 62. DB::Exception: Syntax error: failed at position 1 ('SELEC'): SELEC 1. Expected one of: Query. (SYNTAX_ERROR) (version 24.3.2.23)", config).message).toBe("The database answered: Syntax error: failed at position 1 ('SELEC'): SELEC 1. Expected one of: Query. (SYNTAX_ERROR)");
  });

  it('cancels a read through the fetch signal', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
      });
    const c = clickhouseConnector(hanging);
    const controller = new AbortController();
    const read = c.read({ ...ctx, signal: controller.signal }, { table: { name: 'orders' } });
    setTimeout(() => controller.abort(), 20);
    await expect(read).rejects.toThrow('The read was cancelled.');
  });

  it('writes the SQL of a read in ClickHouse’s dialect and reads defaults', () => {
    expect(readSql({ table: { name: 'orders' } })).toBe('SELECT * FROM "orders"');
    expect(readSql({ table: { schema: 'shop', name: 'or"ders' }, limit: 5 })).toBe('SELECT * FROM "shop"."or""ders" LIMIT 5');
    expect(readSql({ query: 'SELECT 1; ', limit: 2 })).toBe('SELECT * FROM (SELECT 1) AS puddle_query LIMIT 2');
    expect(clickhouseDefault('DEFAULT', "'placed'")).toBe("'placed'");
    expect(clickhouseDefault('MATERIALIZED', 'now()')).toBeUndefined();
    expect(clickhouseDefault('', '')).toBeUndefined();
  });
});
