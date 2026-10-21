// The Firebird driver against the queries recorded from a real Firebird 3.0 (tests/fixtures/db/firebird/,
// regenerated with scripts/record-database.mjs firebird <url>), and against a server that refuses a part.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Connection } from '../../model';
import { ConnectorError } from '../types';
import { firebirdConfigFor, firebirdConnector, firebirdDefault, firebirdProblem, plainValue, readSql, type FirebirdClientLike, type FirebirdConnect, type FirebirdField } from './firebird';
import { SQL_CODES } from './firebirdTypes';

interface Recorded {
  text: string;
  rows: Record<string, unknown>[];
  fields: FirebirdField[];
}

const fixtures = join(__dirname, '../../../tests/fixtures/db/firebird');
const queries = JSON.parse(readFileSync(join(fixtures, 'queries.json'), 'utf8')) as Recorded[];
const recorded = JSON.parse(readFileSync(join(fixtures, 'catalog.json'), 'utf8')) as { test: unknown; catalog: unknown; detail: unknown };

const revive = (v: unknown): unknown => (v && typeof v === 'object' && 'bytes' in v ? new Uint8Array(Buffer.from((v as { bytes: string }).bytes, 'base64')) : v);
const reviveRow = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, revive(v)]));

/** A client that answers each query as the real server did; `refuse` makes it fail the queries a lesser server hasn't got. */
export const replay =
  (refuse?: RegExp): FirebirdConnect =>
  async () => ({
    query: async (sql) => {
      if (refuse?.test(sql)) throw Object.assign(new Error('Dynamic SQL Error, Column unknown'), { gdscode: 335544569 });
      const q = queries.find((x) => x.text === sql);
      if (!q) throw new Error(`No recording for: ${sql}`);
      return { rows: q.rows.map(reviveRow), fields: q.fields };
    },
    end: async () => undefined,
  });

const connection: Connection = { id: 'c', name: 'shop', driver: 'firebird', via: 'local', settings: { host: '127.0.0.1', port: 3050, database: '/var/lib/firebird/3.0/data/shop.fdb', user: 'SYSDBA' }, auth: 'password' };
const ctx = { connection, secret: 'pw' };

describe('the Firebird driver', () => {
  it('tests, catalogues and documents the shop as recorded from Firebird 3.0', async () => {
    const c = firebirdConnector(replay());
    expect(await c.test(ctx)).toEqual(recorded.test);
    expect(await c.catalog(ctx)).toEqual(recorded.catalog);
    expect(await c.document!(ctx)).toEqual(recorded.detail);
  });

  it('reads a table as an Arrow stream with the loader’s types, the text BLOB as text', async () => {
    const c = firebirdConnector(replay());
    const r = await c.read(ctx, { table: { name: 'ORDERS' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(r.columns).toEqual([
      { name: 'ID', sqlType: 'INTEGER' },
      { name: 'CUSTOMER_ID', sqlType: 'INTEGER' },
      { name: 'TOTAL', sqlType: 'DECIMAL(18,2)' },
      { name: 'PLACED_AT', sqlType: 'TIMESTAMP' },
      { name: 'STATUS', sqlType: 'VARCHAR' },
      { name: 'NOTES', sqlType: 'VARCHAR' },
    ]);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('TOTAL')!.toArray()).toEqual(['19.99', '5.50', '120.00', '42.25']);
    expect(t.getChild('NOTES')!.toArray()).toEqual(['Gift wrap', null, null, null]);
    expect(Number(t.getChild('ID')!.get(0))).toBe(101);
    expect(Number(t.getChild('PLACED_AT')!.get(0))).toBe(Date.UTC(2024, 3, 1, 9, 30));
  });

  it('reads a query, typed from its result fields, with dates and booleans converted', async () => {
    const c = firebirdConnector(replay());
    const r = await c.read(ctx, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(2);
    expect(r.columns.map((x) => x.sqlType)).toEqual(['VARCHAR', 'DECIMAL(18,2)', 'TIMESTAMP', 'VARCHAR', 'DATE', 'BOOLEAN']);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('ACTIVE')!.get(0)).toBe(true);
    expect(Number(t.getChild('SIGNED_UP')!.get(0))).toBe(Date.UTC(2024, 0, 15));
  });

  it('still documents the tables where the constraints or indexes can’t be read', async () => {
    const c = firebirdConnector(replay(/RDB\$RELATION_CONSTRAINTS|RDB\$INDICES/));
    const d = await c.document!(ctx);
    expect(d.tables.map((t) => t.name)).toEqual(['CUSTOMERS', 'ORDERS', 'ORDER_TOTALS']);
    const orders = d.tables[1]!;
    expect(orders.indexes).toEqual([]);
    expect(orders.foreignKeys).toEqual([]);
    expect(orders.columns[0]).toMatchObject({ name: 'ID', pk: false, increment: true, notNull: true });
    expect(d.tables[2]!.sql).toMatch(/customers/i);
  });

  it('needs a host, a database path and a user, and turns the settings into a client config', () => {
    expect(() => firebirdConfigFor({ connection: { ...connection, settings: {} } })).toThrow(ConnectorError);
    expect(firebirdConfigFor({ connection: { ...connection, settings: { host: 'db', database: '/data/shop.fdb', user: 'kev', role: 'readers' } }, secret: 'pw' })).toEqual({ host: 'db', port: 3050, database: '/data/shop.fdb', user: 'kev', password: 'pw', role: 'readers' });
    expect(firebirdConfigFor(ctx)).toEqual({ host: '127.0.0.1', port: 3050, database: '/var/lib/firebird/3.0/data/shop.fdb', user: 'SYSDBA', password: 'pw' });
  });

  it('says a failure in plain words without the password', () => {
    const config = firebirdConfigFor(ctx);
    expect(firebirdProblem(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3050'), { code: 'ECONNREFUSED' }), config).message).toBe('Nothing answers at 127.0.0.1:3050.');
    expect(firebirdProblem(Object.assign(new Error('Your user name and password are not defined. Ask your database administrator to set up a Firebird login.'), { gdscode: 335544472 }), config).message).toBe('The database refused the user name or password.');
    expect(firebirdProblem(Object.assign(new Error('I/O error during "open" operation for file "/data/none.fdb"'), { gdscode: 335544344 }), config).message).toMatch(/no database at/);
    expect(firebirdProblem(Object.assign(new Error('Attempted update during read - only transaction'), { gdscode: 335544361 }), config).message).toBe('The connection is read-only, so that statement can’t run.');
    expect(firebirdProblem(new Error('Dynamic SQL Error, Token unknown'), config).message).toBe('The database answered: Dynamic SQL Error, Token unknown');
  });

  it('closes the connection when a read is cancelled, which ends the query', async () => {
    let ended = false;
    const hanging: FirebirdClientLike = {
      query: () =>
        new Promise((_, reject) => {
          const tick = setInterval(() => {
            if (ended) {
              clearInterval(tick);
              reject(new Error('Connection lost'));
            }
          }, 5);
        }),
      end: async () => {
        ended = true;
      },
    };
    const c = firebirdConnector(async () => hanging);
    const controller = new AbortController();
    const read = c.read({ ...ctx, signal: controller.signal }, { table: { name: 'ORDERS' } });
    setTimeout(() => controller.abort(), 20);
    await expect(read).rejects.toThrow('The read was cancelled.');
    expect(ended).toBe(true);
  });

  it('writes the SQL of a read in Firebird’s dialect, reads defaults, and makes the client’s values plain', () => {
    expect(readSql({ table: { name: 'ORDERS' } })).toBe('SELECT * FROM "ORDERS"');
    expect(readSql({ table: { name: 'or"ders' }, limit: 5 })).toBe('SELECT * FROM "or""ders" FETCH FIRST 5 ROWS ONLY');
    expect(readSql({ query: 'SELECT 1 FROM RDB$DATABASE; ', limit: 2 })).toBe('SELECT * FROM (SELECT 1 FROM RDB$DATABASE) AS puddle_query FETCH FIRST 2 ROWS ONLY');
    expect(firebirdDefault("DEFAULT 'placed'")).toBe("'placed'");
    expect(firebirdDefault('DEFAULT TRUE')).toBe('TRUE');
    expect(firebirdDefault(null)).toBeUndefined();
    expect(plainValue({ type: SQL_CODES.DATE, scale: 0 }, new Date(2024, 0, 15))).toBe('2024-01-15');
    expect(plainValue({ type: SQL_CODES.TIMESTAMP, scale: 0 }, new Date(2024, 3, 1, 9, 30))).toBe('2024-04-01 09:30:00.000');
    expect(plainValue({ type: SQL_CODES.TIME, scale: 0 }, new Date(1970, 0, 1, 14, 0, 1))).toBe('14:00:01.000');
    expect(plainValue({ type: SQL_CODES.LONG, scale: -2 }, 19.99)).toBe('19.99');
    expect(plainValue({ type: SQL_CODES.LONG, scale: -2 }, 5.5)).toBe('5.50');
    expect(plainValue({ type: SQL_CODES.INT64, scale: -2 }, '120.00')).toBe('120.00');
    expect(plainValue({ type: SQL_CODES.VARYING, scale: 0 }, null)).toBeNull();
  });
});
