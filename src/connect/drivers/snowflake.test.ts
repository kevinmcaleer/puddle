// The Snowflake driver against recorded exchanges in the SQL REST API's shape (tests/fixtures/db/snowflake/, recorded
// from scripts/snowflake-stand-in.mjs with scripts/record-database.mjs snowflake <url>; a real account records the
// same way), and against an account that refuses a part. The key the tests sign with is a throwaway made for the run.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Connection } from '../../model';
import { replayFetch } from '../../../tests/helpers/replayFetch';
import { testPrivateKeyPem } from '../../../tests/helpers/testKey';
import { ConnectorError, type ConnectorContext } from '../types';
import { ident, jwtAccount, readSql, showKeysSql, snowflakeConfigFor, snowflakeConnector, snowflakeProblem, tablesSql } from './snowflake';

const recorded = JSON.parse(readFileSync(join(__dirname, '../../../tests/fixtures/db/snowflake/catalog.json'), 'utf8')) as { test: unknown; catalog: unknown; detail: unknown };

const connection: Connection = { id: 'c', name: 'shop', driver: 'snowflake', via: 'local', settings: { account: 'xy12345.eu-west-2.aws', user: 'puddle', warehouse: 'compute_wh', database: 'shop', schema: 'public', url: 'http://127.0.0.1:18091' }, auth: 'keypair' };
let ctx: ConnectorContext;
beforeAll(async () => {
  ctx = { connection, secret: await testPrivateKeyPem() };
});

describe('the Snowflake driver', () => {
  it('signs in with the key pair, then tests, catalogues and documents the schema as recorded', async () => {
    const f = replayFetch('snowflake');
    const c = snowflakeConnector(f);
    expect(await c.test(ctx)).toEqual(recorded.test);
    expect(await c.catalog(ctx)).toEqual(recorded.catalog);
    expect(await c.document!(ctx)).toEqual(recorded.detail);
    expect(f.calls.every((x) => !x.body?.includes('BEGIN PRIVATE KEY'))).toBe(true);
  });

  it('reads a table as an Arrow stream, waiting for the statement and gathering its partitions, the array, object and zoned timestamp as text', async () => {
    const c = snowflakeConnector(replayFetch('snowflake'));
    const r = await c.read(ctx, { table: { name: 'ORDERS' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(r.columns).toEqual([
      { name: 'ID', sqlType: 'BIGINT' },
      { name: 'CUSTOMER_ID', sqlType: 'BIGINT' },
      { name: 'TOTAL', sqlType: 'DECIMAL(10,2)' },
      { name: 'PLACED_AT', sqlType: 'TIMESTAMP' },
      { name: 'DELIVERED_AT', sqlType: 'TIMESTAMP WITH TIME ZONE' },
      { name: 'STATUS', sqlType: 'VARCHAR' },
      { name: 'NOTES', sqlType: 'VARCHAR' },
      { name: 'TAGS', sqlType: 'JSON' },
      { name: 'SHIPPING', sqlType: 'JSON' },
    ]);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('TOTAL')!.toArray()).toEqual(['19.99', '5.50', '120.00', '42.25']);
    expect(JSON.parse(t.getChild('TAGS')!.get(0) as string)).toEqual(['gift', 'express']);
    expect(JSON.parse(t.getChild('SHIPPING')!.get(2) as string)).toEqual({ city: 'Leeds', postcode: 'LS1 1UR' });
    expect(t.getChild('DELIVERED_AT')!.get(0)).toBe('2024-04-02 09:00:00+01:00');
    expect(t.getChild('DELIVERED_AT')!.get(1)).toBeNull();
    expect(Number(t.getChild('PLACED_AT')!.get(0))).toBe(Date.UTC(2024, 3, 1, 9, 30));
  });

  it('reads a query as a subquery, typed from the result', async () => {
    const c = snowflakeConnector(replayFetch('snowflake'));
    const r = await c.read(ctx, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(2);
    expect(r.columns.map((x) => x.sqlType)).toEqual(['VARCHAR', 'DECIMAL(10,2)', 'TIMESTAMP', 'VARCHAR', 'DATE', 'BOOLEAN']);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('ACTIVE')!.get(0)).toBe(true);
    expect(Number(t.getChild('SIGNED_UP')!.get(0))).toBe(Date.UTC(2024, 0, 15));
  });

  it('still documents the tables where SHOW is refused, and says when the key is refused', async () => {
    const c = snowflakeConnector(replayFetch('snowflake', { test: (x) => /SHOW (PRIMARY|UNIQUE|IMPORTED) KEYS/.test(x), status: 422, response: JSON.stringify({ code: '003001', message: 'SQL access control error:\nInsufficient privileges to operate on schema', sqlState: '42501' }) }));
    const d = await c.document!(ctx);
    expect(d.tables.map((t) => t.name)).toEqual(['CUSTOMERS', 'ORDERS', 'ORDER_TOTALS']);
    expect(d.tables.every((t) => t.foreignKeys.length === 0 && t.columns.every((x) => !x.pk))).toBe(true);
    expect(d.tables[2]!.sql).toMatch(/customers/i);
    const refused = snowflakeConnector(replayFetch('snowflake', { test: () => true, status: 401, response: JSON.stringify({ code: '390144', message: 'JWT token is invalid.' }) }));
    await expect(refused.test(ctx)).rejects.toThrow('Snowflake refused the key for PUDDLE.');
  });

  it('cancels a statement it is waiting on', async () => {
    const calls: string[] = [];
    const slow: typeof fetch = async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      if (init?.method === 'POST' && String(input).endsWith('/cancel')) return new Response('{}', { status: 200 });
      if (init?.method === 'POST') return new Response(JSON.stringify({ statementHandle: 'h1', code: '333334' }), { status: 202 });
      await new Promise((r) => setTimeout(r, 30));
      return new Response(JSON.stringify({ statementHandle: 'h1', code: '333334' }), { status: 202 });
    };
    const c = snowflakeConnector(slow);
    const controller = new AbortController();
    const read = c.read({ ...ctx, signal: controller.signal }, { table: { name: 'ORDERS' } });
    setTimeout(() => controller.abort(), 10);
    await expect(read).rejects.toThrow('The read was cancelled.');
    expect(calls).toContain('POST http://127.0.0.1:18091/api/v2/statements/h1/cancel');
  });

  it('needs an account, a user and the key, names objects as Snowflake resolves them, and keeps the account’s address unless the settings name another', async () => {
    expect(() => snowflakeConfigFor({ connection: { ...connection, settings: {} } })).toThrow('Give the account.');
    expect(() => snowflakeConfigFor({ connection: { ...connection, settings: { account: 'a' } } })).toThrow('Give the user name.');
    expect(() => snowflakeConfigFor({ connection: { ...connection, settings: { account: 'a', user: 'u' } } })).toThrow('Paste the private key to sign in.');
    expect(() => snowflakeConfigFor({ connection: { ...connection, settings: { account: 'a', user: 'u' } }, secret: 'not a key' })).toThrow(ConnectorError);
    const config = snowflakeConfigFor({ connection: { ...connection, settings: { account: 'myorg-myaccount.snowflakecomputing.com', user: 'kev', database: '"Shop"', schema: 'sales', role: 'reader' } }, secret: ctx.secret });
    expect(config).toMatchObject({ url: 'https://myorg-myaccount.snowflakecomputing.com', account: 'myorg-myaccount', user: 'KEV', database: 'Shop', schema: 'SALES', role: 'READER' });
    expect(config.warehouse).toBeUndefined();
    expect(snowflakeConfigFor(ctx)).toMatchObject({ url: 'http://127.0.0.1:18091', user: 'PUDDLE', warehouse: 'COMPUTE_WH', database: 'SHOP', schema: 'PUBLIC' });
    expect(jwtAccount('xy12345.eu-west-2.aws')).toBe('XY12345');
    expect(jwtAccount('myorg-myaccount')).toBe('MYORG-MYACCOUNT');
    expect(ident('"Mixed Case"')).toBe('Mixed Case');
    expect(tablesSql(config)).toBe(`SELECT table_schema, table_name, table_type, row_count, comment FROM "Shop".INFORMATION_SCHEMA.TABLES WHERE table_schema <> 'INFORMATION_SCHEMA' AND table_schema = 'SALES' ORDER BY table_schema, table_name`);
    expect(showKeysSql({ ...config, schema: undefined }, 'IMPORTED')).toBe('SHOW IMPORTED KEYS IN DATABASE "Shop"');
    expect(() => tablesSql({ ...config, database: undefined })).toThrow('Give the database to read.');
  });

  it('says a failure in plain words', () => {
    const config = snowflakeConfigFor(ctx);
    expect(snowflakeProblem(401, { code: '390144', message: 'JWT token is invalid.' }, '', config).message).toBe('Snowflake refused the key for PUDDLE.');
    expect(snowflakeProblem(422, { code: '000606', message: 'No active warehouse selected in the current session.  Select an active warehouse with the \'use warehouse\' command.' }, '', config).message).toBe('Give the warehouse to run on.');
    expect(snowflakeProblem(422, { code: '002003', message: "SQL compilation error:\nDatabase 'NOTHING' does not exist or not authorized." }, '', config).message).toBe('There is no database called NOTHING in xy12345.eu-west-2.aws.');
    expect(snowflakeProblem(422, { code: '001003', message: "SQL compilation error:\nsyntax error line 1 at position 0 unexpected 'SELEC'." }, '', config).message).toBe("Snowflake answered: SQL compilation error: syntax error line 1 at position 0 unexpected 'SELEC'.");
    expect(snowflakeProblem(404, undefined, '<html>Not found</html>', config).message).toBe('127.0.0.1:18091 didn’t answer as Snowflake does; check the address.');
    expect(snowflakeProblem(500, undefined, '', config).message).toBe('Snowflake answered: status 500');
  });

  it('writes the SQL of a read in Snowflake’s dialect, in the table’s schema or the connection’s', () => {
    const config = snowflakeConfigFor(ctx);
    expect(readSql(config, { table: { name: 'ORDERS' } })).toBe('SELECT * FROM "SHOP"."PUBLIC"."ORDERS"');
    expect(readSql(config, { table: { schema: 'SALES', name: 'Or"ders' }, limit: 5 })).toBe('SELECT * FROM "SHOP"."SALES"."Or""ders" LIMIT 5');
    expect(readSql(config, { query: 'SELECT 1; ', limit: 2 })).toBe('SELECT * FROM (SELECT 1) AS puddle_query LIMIT 2');
    expect(() => readSql({ ...config, schema: undefined }, { table: { name: 'ORDERS' } })).toThrow('Give the schema to read.');
  });
});
