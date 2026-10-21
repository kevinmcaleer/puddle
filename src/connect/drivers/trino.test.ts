// The Trino driver against recorded exchanges in the REST protocol's shape (tests/fixtures/db/trino/, regenerated
// with scripts/record-database.mjs trino <url>), and against a cluster that refuses a part.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Connection } from '../../model';
import { replayFetch } from '../../../tests/helpers/replayFetch';
import { ConnectorError } from '../types';
import { readSql, statementHeaders, tablesSql, trinoConfigFor, trinoConnector, trinoProblem } from './trino';

const recorded = JSON.parse(readFileSync(join(__dirname, '../../../tests/fixtures/db/trino/catalog.json'), 'utf8')) as { test: unknown; catalog: unknown; detail: unknown };

const connection: Connection = { id: 'c', name: 'shop', driver: 'trino', via: 'browser', settings: { url: 'http://127.0.0.1:18080', catalog: 'memory', schema: 'shop', user: 'puddle' }, auth: 'password' };
const ctx = { connection };

describe('the Trino driver', () => {
  it('tests, catalogues and documents the shop as recorded, following each statement’s pages', async () => {
    const c = trinoConnector(replayFetch('trino'));
    expect(await c.test(ctx)).toEqual(recorded.test);
    expect(await c.catalog(ctx)).toEqual(recorded.catalog);
    expect(await c.document!(ctx)).toEqual(recorded.detail);
  });

  it('reads a table as an Arrow stream with the loader’s types, the array as JSON text', async () => {
    const c = trinoConnector(replayFetch('trino'));
    const r = await c.read(ctx, { table: { name: 'orders' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(r.columns).toEqual([
      { name: 'id', sqlType: 'INTEGER' },
      { name: 'customer_id', sqlType: 'INTEGER' },
      { name: 'total', sqlType: 'DECIMAL(10,2)' },
      { name: 'placed_at', sqlType: 'TIMESTAMP' },
      { name: 'status', sqlType: 'VARCHAR' },
      { name: 'notes', sqlType: 'VARCHAR' },
      { name: 'tags', sqlType: 'JSON' },
    ]);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('total')!.toArray()).toEqual(['19.99', '5.50', '120.00', '42.25']);
    expect(t.getChild('tags')!.get(0)).toBe('["gift","express"]');
    expect(Number(t.getChild('placed_at')!.get(0))).toBe(Date.UTC(2024, 3, 1, 9, 30));
  });

  it('reads a query as a subquery, typed from the result', async () => {
    const c = trinoConnector(replayFetch('trino'));
    const r = await c.read(ctx, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(2);
    expect(r.columns.map((x) => x.sqlType)).toEqual(['VARCHAR', 'DECIMAL(10,2)', 'TIMESTAMP', 'VARCHAR', 'DATE', 'BOOLEAN']);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('active')!.get(0)).toBe(true);
    expect(Number(t.getChild('signed_up')!.get(0))).toBe(Date.UTC(2024, 0, 15));
  });

  it('still documents the tables where the views can’t be read, and says when the cluster refuses', async () => {
    const c = trinoConnector(replayFetch('trino', { test: (x) => /information_schema\.views/.test(x), status: 200, response: JSON.stringify({ id: 'x', error: { message: 'Access Denied: Cannot select from table memory.information_schema.views', errorName: 'PERMISSION_DENIED' } }) }));
    const d = await c.document!(ctx);
    expect(d.tables.map((t) => t.name)).toEqual(['customers', 'order_totals', 'orders']);
    expect(d.tables[1]!.sql).toBeUndefined();
    const refused = trinoConnector(replayFetch('trino', { test: () => true, status: 401, response: 'Unauthorized' }));
    await expect(refused.test(ctx)).rejects.toThrow('The server refused the user name or password.');
  });

  it('needs an address and a user, names the catalog and schema in the headers, and signs in with Basic auth only when there is a password', () => {
    expect(() => trinoConfigFor({ connection: { ...connection, settings: {} } })).toThrow(ConnectorError);
    expect(() => trinoConfigFor({ connection: { ...connection, settings: { url: 'http://t:8080' } } })).toThrow('Give the user name.');
    const config = trinoConfigFor({ connection: { ...connection, settings: { url: 'https://t.example.com/', catalog: 'hive', schema: '', user: 'kev' } }, secret: 'pw' });
    expect(config).toEqual({ url: 'https://t.example.com', catalog: 'hive', schema: '', user: 'kev', password: 'pw' });
    const h = statementHeaders(config);
    expect(h['X-Trino-User']).toBe('kev');
    expect(h['X-Presto-User']).toBe('kev');
    expect(h['X-Trino-Catalog']).toBe('hive');
    expect(h['X-Trino-Schema']).toBeUndefined();
    expect(h.Authorization).toBe(`Basic ${btoa('kev:pw')}`);
    expect(statementHeaders(trinoConfigFor(ctx)).Authorization).toBeUndefined();
    expect(tablesSql(config)).toBe(`SELECT table_schema, table_name, table_type FROM "hive".information_schema.tables WHERE table_schema <> 'information_schema' ORDER BY table_schema, table_name`);
    expect(tablesSql(trinoConfigFor(ctx))).toContain("AND table_schema = 'shop'");
  });

  it('says a failure in plain words without the password', () => {
    const config = trinoConfigFor(ctx);
    expect(trinoProblem(401, undefined, '', config).message).toBe('The server refused the user name or password.');
    expect(trinoProblem(200, { error: { message: "line 1:15: Catalog 'nothing' not found", errorName: 'CATALOG_NOT_FOUND' } }, '', config).message).toBe('There is no catalog called memory at 127.0.0.1:18080.');
    expect(trinoProblem(200, { error: { message: "line 1:15: Schema 'x' does not exist", errorName: 'SCHEMA_NOT_FOUND' } }, '', config).message).toBe('There is no schema called shop in memory.');
    expect(trinoProblem(200, { error: { message: "line 1:1: mismatched input 'SELEC'. Expecting: 'SELECT'", errorName: 'SYNTAX_ERROR' } }, '', config).message).toBe("The server answered: line 1:1: mismatched input 'SELEC'. Expecting: 'SELECT'");
    expect(trinoProblem(404, undefined, '<html>Not found</html>', config).message).toBe('127.0.0.1:18080 didn’t answer as Trino does; check the address.');
  });

  it('cancels a read between pages, deleting the page it was on', async () => {
    const calls: string[] = [];
    const slow: typeof fetch = async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'q', nextUri: 'http://t/v1/statement/queued/q/1' }), { status: 200 });
      if (init?.method === 'DELETE') return new Response('', { status: 204 });
      await new Promise((r) => setTimeout(r, 30));
      return new Response(JSON.stringify({ id: 'q', nextUri: 'http://t/v1/statement/queued/q/2', data: [[1]], columns: [{ name: 'n', type: 'integer' }] }), { status: 200 });
    };
    const c = trinoConnector(slow);
    const controller = new AbortController();
    const read = c.read({ ...ctx, signal: controller.signal }, { table: { name: 'orders' } });
    setTimeout(() => controller.abort(), 10);
    await expect(read).rejects.toThrow('The read was cancelled.');
    expect(calls).toContain('DELETE http://t/v1/statement/queued/q/1');
  });

  it('writes the SQL of a read in Trino’s dialect', () => {
    expect(readSql({ table: { name: 'orders' } })).toBe('SELECT * FROM "orders"');
    expect(readSql({ table: { schema: 'shop', name: 'or"ders' }, limit: 5 })).toBe('SELECT * FROM "shop"."or""ders" LIMIT 5');
    expect(readSql({ query: 'SELECT 1; ', limit: 2 })).toBe('SELECT * FROM (SELECT 1) AS puddle_query LIMIT 2');
  });
});
