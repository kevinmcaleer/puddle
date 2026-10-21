// The MySQL family driver against the queries recorded from a real MariaDB 10.11 (tests/fixtures/db/mysql/,
// regenerated with scripts/record-database.mjs mysql <url>), and against a server that lacks what TiDB lacks.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Connection } from '../../model';
import { ConnectorError } from '../types';
import { mysqlConfigFor, mysqlConnector, mysqlDefault, mysqlProblem, readSql, shortVersion, type MysqlClientLike, type MysqlConnect, type MysqlField } from './mysql';

interface Recorded {
  text: string;
  rowMode?: boolean;
  rows: unknown[];
  fields: MysqlField[];
}

const fixtures = join(__dirname, '../../../tests/fixtures/db/mysql');
const queries = JSON.parse(readFileSync(join(fixtures, 'queries.json'), 'utf8')) as Recorded[];
const recorded = JSON.parse(readFileSync(join(fixtures, 'catalog.json'), 'utf8')) as { test: unknown; catalog: unknown; detail: unknown };

/** Recorded bytes come back as bytes, as mysql2 gives them with typeCast off. */
const revive = (v: unknown): unknown => (v && typeof v === 'object' && 'bytes' in v ? new Uint8Array(Buffer.from((v as { bytes: string }).bytes, 'base64')) : v);
const reviveRow = (row: unknown) => (Array.isArray(row) ? row.map(revive) : Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, revive(v)])));

/** A client that answers each query as the real server did; `refuse` makes it fail the queries a lesser database hasn't got. */
export const replay =
  (refuse?: RegExp): MysqlConnect =>
  async () => ({
    query: async (sql, rowsAsArray) => {
      if (refuse?.test(sql)) throw Object.assign(new Error("Unknown table 'X' in information_schema"), { code: 'ER_UNKNOWN_TABLE' });
      const q = queries.find((x) => x.text === sql && (x.rowMode ?? undefined) === rowsAsArray);
      if (!q) throw new Error(`No recording for: ${sql}`);
      return { rows: q.rows.map(reviveRow), fields: q.fields };
    },
    end: async () => undefined,
  });

const connection: Connection = { id: 'c', name: 'shop', driver: 'mariadb', via: 'local', settings: { host: '127.0.0.1', port: 33069, database: 'shop', user: 'puddle' }, auth: 'password' };
const ctx = { connection, secret: 'pw' };

describe('the MySQL driver', () => {
  it('tests, catalogues and documents the shop as recorded from MariaDB', async () => {
    const c = mysqlConnector('mariadb', replay());
    expect(await c.test(ctx)).toEqual(recorded.test);
    expect(await c.catalog(ctx)).toEqual(recorded.catalog);
    expect(await c.document!(ctx)).toEqual(recorded.detail);
  });

  it('reads a table as an Arrow stream with the loader’s types', async () => {
    const c = mysqlConnector('mysql', replay());
    const r = await c.read(ctx, { table: { name: 'orders' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(r.columns).toEqual([
      { name: 'id', sqlType: 'INTEGER' },
      { name: 'customer_id', sqlType: 'INTEGER' },
      { name: 'total', sqlType: 'DECIMAL(10,2)' },
      { name: 'placed_at', sqlType: 'TIMESTAMP' },
      { name: 'status', sqlType: 'VARCHAR' },
    ]);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('total')!.toArray()).toEqual(['19.99', '5.50', '120.00', '42.25']);
    expect(t.getChild('status')!.get(0)).toBe('shipped');
    expect(Number(t.getChild('id')!.get(0))).toBe(101);
    expect(Number(t.getChild('placed_at')!.get(0))).toBe(Date.UTC(2024, 3, 1, 9, 30));
  });

  it('reads a query, typed from its result fields, with dates and booleans converted', async () => {
    const c = mysqlConnector('mysql', replay());
    const r = await c.read(ctx, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(2);
    expect(r.columns.map((x) => x.sqlType)).toEqual(['VARCHAR', 'DECIMAL(10,2)', 'TIMESTAMP', 'VARCHAR', 'DATE', 'BOOLEAN']);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('active')!.get(0)).toBe(true);
    expect(Number(t.getChild('signed_up')!.get(0))).toBe(Date.UTC(2024, 0, 15));
  });

  it('still documents tables and keys where the database has no STATISTICS, KEY_COLUMN_USAGE or VIEWS', async () => {
    const c = mysqlConnector('tidb', replay(/STATISTICS|KEY_COLUMN_USAGE|information_schema\.VIEWS/));
    const d = await c.document!(ctx);
    expect(d.tables.map((t) => t.name)).toEqual(['customers', 'orders', 'order_totals']);
    const orders = d.tables[1]!;
    expect(orders.indexes).toEqual([]);
    expect(orders.foreignKeys).toEqual([]);
    expect(orders.columns[0]).toMatchObject({ name: 'id', pk: false, increment: true, notNull: true });
    expect(d.tables[2]!.sql).toBeUndefined();
    expect(d.enums).toEqual([{ name: 'orders_status', values: ['placed', 'shipped', 'returned'] }]);
  });

  it('needs a host, a database and a user, and turns the settings into a client config', () => {
    expect(() => mysqlConfigFor({ connection: { ...connection, settings: {} } })).toThrow(ConnectorError);
    expect(mysqlConfigFor({ connection: { ...connection, settings: { host: 'db', database: 'shop', user: 'kev', ssl: true } }, secret: 'pw' })).toEqual({ host: 'db', port: 3306, database: 'shop', user: 'kev', password: 'pw', ssl: { rejectUnauthorized: true } });
    expect(mysqlConfigFor({ connection: { ...connection, settings: { host: 'db', port: 4000, database: 'shop', user: 'kev', ssl: true, sslVerify: false } } }).ssl).toEqual({ rejectUnauthorized: false });
    expect(mysqlConfigFor(ctx).ssl).toBeUndefined();
  });

  it('says a failure in plain words without the password', () => {
    const config = mysqlConfigFor(ctx);
    expect(mysqlProblem(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), config).message).toBe('Nothing answers at 127.0.0.1:33069.');
    expect(mysqlProblem(Object.assign(new Error("Access denied for user 'puddle'@'localhost' (using password: YES)"), { code: 'ER_ACCESS_DENIED_ERROR' }), config).message).toBe('The database refused the user name or password.');
    expect(mysqlProblem(Object.assign(new Error("Unknown database 'shop'"), { code: 'ER_BAD_DB_ERROR' }), config).message).toMatch(/no database called shop/);
    expect(mysqlProblem(new Error('self signed certificate'), config).message).toMatch(/certificate/);
    expect(mysqlProblem(new Error('Server does not support secure connection'), config).message).toMatch(/Use SSL/);
    expect(mysqlProblem(new Error('You have an error in your SQL syntax'), config).message).toBe('The database answered: You have an error in your SQL syntax');
  });

  it('closes the connection when a read is cancelled, which ends the query', async () => {
    let ended = false;
    const hanging: MysqlClientLike = {
      query: (sql) =>
        sql.startsWith('SET')
          ? Promise.resolve({ rows: [], fields: [] })
          : new Promise((_, reject) => {
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
    const c = mysqlConnector('mysql', async () => hanging);
    const controller = new AbortController();
    const read = c.read({ ...ctx, signal: controller.signal }, { table: { name: 'orders' } });
    setTimeout(() => controller.abort(), 20);
    await expect(read).rejects.toThrow('The read was cancelled.');
    expect(ended).toBe(true);
  });

  it('writes the SQL of a read in MySQL’s dialect, and reads defaults and versions', () => {
    expect(readSql({ table: { name: 'orders' } })).toBe('SELECT * FROM `orders`');
    expect(readSql({ table: { schema: 'sales', name: 'or`ders' }, limit: 5 })).toBe('SELECT * FROM `sales`.`or``ders` LIMIT 5');
    expect(readSql({ query: 'SELECT 1 ORDER BY 1; ', limit: 2 })).toBe('SELECT * FROM (SELECT 1 ORDER BY 1) AS puddle_query LIMIT 2');
    // MariaDB quotes string defaults and writes NULL as text; MySQL and TiDB write the bare value.
    expect(mysqlDefault({ DATA_TYPE: 'enum', COLUMN_DEFAULT: "'placed'", EXTRA: '' })).toBe("'placed'");
    expect(mysqlDefault({ DATA_TYPE: 'enum', COLUMN_DEFAULT: 'placed', EXTRA: '' })).toBe("'placed'");
    expect(mysqlDefault({ DATA_TYPE: 'int', COLUMN_DEFAULT: '0', EXTRA: '' })).toBe('0');
    expect(mysqlDefault({ DATA_TYPE: 'int', COLUMN_DEFAULT: 'NULL', EXTRA: '' })).toBeUndefined();
    expect(mysqlDefault({ DATA_TYPE: 'int', COLUMN_DEFAULT: null, EXTRA: '' })).toBeUndefined();
    expect(mysqlDefault({ DATA_TYPE: 'timestamp', COLUMN_DEFAULT: 'CURRENT_TIMESTAMP', EXTRA: 'DEFAULT_GENERATED' })).toBe('CURRENT_TIMESTAMP');
    expect(mysqlDefault({ DATA_TYPE: 'datetime', COLUMN_DEFAULT: 'current_timestamp()', EXTRA: '' })).toBe('current_timestamp()');
    expect(shortVersion('10.11.14-MariaDB-0ubuntu0.24.04.1')).toBe('MariaDB 10.11.14');
    expect(shortVersion('8.0.36')).toBe('MySQL 8.0.36');
    expect(shortVersion('8.0.11-TiDB-v7.5.0')).toBe('TiDB v7.5.0');
  });
});
