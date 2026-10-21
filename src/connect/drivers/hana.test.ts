// The SAP HANA driver against the queries a HANA answers (tests/fixtures/db/hana/, written by hand to the SYS views'
// documented shapes since no HANA runs in CI; a real one re-records them with scripts/record-database.mjs hana <url>),
// and against a server that refuses a part.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Connection } from '../../model';
import { ConnectorError } from '../types';
import { hanaConfigFor, hanaConnector, hanaProblem, readSql, shortVersion, type HanaConnect, type HanaField } from './hana';

interface Recorded {
  text: string;
  rows: unknown[][];
  fields: HanaField[];
}

const fixtures = join(__dirname, '../../../tests/fixtures/db/hana');
const queries = JSON.parse(readFileSync(join(fixtures, 'queries.json'), 'utf8')) as Recorded[];
const recorded = JSON.parse(readFileSync(join(fixtures, 'catalog.json'), 'utf8')) as { test: unknown; catalog: unknown; detail: unknown };

/** A client that answers each statement as the server would; `refuse` makes it fail the ones a lesser user can't run. */
const replay =
  (refuse?: RegExp, onEnd?: () => void): HanaConnect =>
  async () => ({
    query: async (sql) => {
      if (refuse?.test(sql)) throw Object.assign(new Error('SQL error, server error code: 258. insufficient privilege: Not authorized'), { code: 258 });
      const q = queries.find((x) => x.text === sql);
      if (!q) throw new Error(`No recording for: ${sql}`);
      return { rows: q.rows, fields: q.fields };
    },
    end: async () => onEnd?.(),
  });

const connection: Connection = { id: 'c', name: 'shop', driver: 'hana', via: 'local', settings: { host: 'localhost', port: 39015, database: 'HXE', user: 'SHOP' }, auth: 'password' };
const ctx = { connection, secret: 'pw' };

describe('the SAP HANA driver', () => {
  it('tests, catalogues and documents the shop as a HANA answers', async () => {
    const c = hanaConnector(replay());
    expect(await c.test(ctx)).toEqual(recorded.test);
    expect(await c.catalog(ctx)).toEqual(recorded.catalog);
    expect(await c.document!(ctx)).toEqual(recorded.detail);
  });

  it('reads a table as an Arrow stream: the DECIMAL exact, the timestamp parsed, the null kept', async () => {
    const r = await hanaConnector(replay()).read(ctx, { table: { name: 'ORDERS' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(r.columns).toEqual([
      { name: 'ID', sqlType: 'BIGINT' },
      { name: 'CUSTOMER_ID', sqlType: 'BIGINT' },
      { name: 'TOTAL', sqlType: 'DECIMAL(10,2)' },
      { name: 'PLACED_AT', sqlType: 'TIMESTAMP' },
      { name: 'STATUS', sqlType: 'VARCHAR' },
      { name: 'NOTES', sqlType: 'VARCHAR' },
    ]);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('TOTAL')!.toArray()).toEqual(['19.99', '5.50', '120.00', '42.25']);
    expect(t.getChild('NOTES')!.toArray()).toEqual(['Gift wrap', null, null, null]);
    expect(Number(t.getChild('PLACED_AT')!.get(0))).toBe(Date.parse('2024-04-01T09:30:00Z'));
  });

  it('reads a query inside a derived table bounded by LIMIT, typed from the result columns: a date and a boolean', async () => {
    const r = await hanaConnector(replay()).read(ctx, { query: 'SELECT c.NAME, o.TOTAL, o.PLACED_AT, o.STATUS, c.SIGNED_UP, c.ACTIVE FROM ORDERS o JOIN CUSTOMERS c ON c.ID = o.CUSTOMER_ID ORDER BY o.ID;', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(2);
    expect(r.columns.map((c) => c.sqlType)).toEqual(['VARCHAR', 'DECIMAL(10,2)', 'TIMESTAMP', 'VARCHAR', 'DATE', 'BOOLEAN']);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('ACTIVE')!.toArray()).toEqual([true, true]);
    expect(String(t.getChild('SIGNED_UP')!.get(0))).toMatch(/2024-01-15|1705276800000/);
  });

  it('refuses a statement that writes before sending it, and closes the client when a read is cancelled', async () => {
    const c = hanaConnector(replay());
    await expect(c.read(ctx, { query: "UPDATE ORDERS SET STATUS = 'x'" })).rejects.toThrow(/Only a query that reads/);
    await expect(c.read(ctx, {})).rejects.toThrow('Choose a table or write a query.');
    let ended = 0;
    const slow: HanaConnect = async () => ({ query: () => new Promise(() => undefined), end: async () => void ended++ });
    const controller = new AbortController();
    const read = hanaConnector(slow).read({ ...ctx, signal: controller.signal }, { table: { name: 'ORDERS' } });
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await expect(Promise.race([read, new Promise((_, reject) => setTimeout(() => reject(new Error('still waiting')), 200))])).rejects.toThrow(/still waiting|cancelled/);
    expect(ended).toBe(1);
    // Cancelled before the connection was made: closed and said so.
    const early = new AbortController();
    early.abort();
    await expect(hanaConnector(slow).read({ ...ctx, signal: early.signal }, { table: { name: 'ORDERS' } })).rejects.toThrow('The read was cancelled.');
    expect(ended).toBe(2);
  });

  it('still documents the tables where the SYS views it may not read are empty', async () => {
    const c = hanaConnector(replay(/REFERENTIAL_CONSTRAINTS|SYS\.INDEXES|SYS\.VIEWS/));
    const d = await c.document!(ctx);
    expect(d.tables.map((t) => t.name)).toEqual(['CUSTOMERS', 'ORDERS']);
    expect(d.tables[1]!.foreignKeys).toEqual([]);
    expect((await c.catalog(ctx)).tables.map((t) => t.kind)).toEqual(['table', 'table']);
  });

  it('needs a host and a user, turns the settings into a client config, and says a failure in plain words', () => {
    expect(hanaConfigFor(ctx)).toEqual({ host: 'localhost', port: 39015, database: 'HXE', user: 'SHOP', password: 'pw', ssl: true, sslVerify: true });
    expect(hanaConfigFor({ connection: { ...connection, settings: { host: 'h', user: 'u', ssl: false, sslVerify: false } } })).toEqual({ host: 'h', port: 39015, user: 'u', ssl: false, sslVerify: false });
    expect(() => hanaConfigFor({ connection: { ...connection, settings: {} } })).toThrow('Give the database host.');
    expect(() => hanaConfigFor({ connection: { ...connection, settings: { host: 'h' } } })).toThrow('Give the user name.');
    const config = hanaConfigFor(ctx);
    expect(hanaProblem(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), config).message).toBe('Nothing answers at localhost:39015.');
    expect(hanaProblem(Object.assign(new Error('authentication failed'), { code: 10 }), config).message).toBe('The database refused the user name or password.');
    expect(hanaProblem(new Error('No authentication method found.'), config).message).toBe('The database and the client agree on no way to sign in.');
    expect(hanaProblem(new Error('self signed certificate'), config).message).toBe('localhost’s certificate isn’t trusted.');
    expect(hanaProblem(Object.assign(new Error('insufficient privilege: Not authorized'), { code: 258 }), config).message).toBe('The user may not read that: insufficient privilege: Not authorized');
    expect(hanaProblem(new Error('SQL error, server error code: 259. invalid table name: NOPE'), config).message).toBe('The database answered: invalid table name: NOPE');
    expect(hanaProblem(new ConnectorError('as is'), config).message).toBe('as is');
    expect(shortVersion('2.00.076.00.1705400033')).toBe('SAP HANA 2.00.076');
    expect(shortVersion('x')).toBe('SAP HANA x');
    expect(readSql({ table: { schema: 'SHOP', name: 'OR"DERS' }, limit: 5 })).toBe('SELECT * FROM "SHOP"."OR""DERS" LIMIT 5');
    expect(readSql({ query: 'SELECT 1 FROM DUMMY' })).toBe('SELECT 1 FROM DUMMY');
  });
});
