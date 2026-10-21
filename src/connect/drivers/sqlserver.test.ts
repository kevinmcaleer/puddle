// The SQL Server driver against the queries a SQL Server 2022 answers (tests/fixtures/db/sqlserver/, regenerated
// with scripts/record-database.mjs sqlserver <url>), and against a server that refuses a part.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Connection } from '../../model';
import { ConnectorError } from '../types';
import { plainValue, readSql, shortVersion, sqlserverConfigFor, sqlserverConnector, sqlserverDefault, sqlserverProblem, type SqlserverClientLike, type SqlserverConnect, type SqlserverField } from './sqlserver';

interface Recorded {
  text: string;
  rows: unknown[][];
  fields: SqlserverField[];
}

const fixtures = join(__dirname, '../../../tests/fixtures/db/sqlserver');
const queries = JSON.parse(readFileSync(join(fixtures, 'queries.json'), 'utf8')) as Recorded[];
const recorded = JSON.parse(readFileSync(join(fixtures, 'catalog.json'), 'utf8')) as { test: unknown; catalog: unknown; detail: unknown };

const revive = (v: unknown): unknown => (v && typeof v === 'object' && 'bytes' in v ? new Uint8Array(Buffer.from((v as { bytes: string }).bytes, 'base64')) : v);

/** A client that answers each statement as the real server did; `refuse` makes it fail the ones a lesser login can't run. */
export const replay =
  (refuse?: RegExp): SqlserverConnect =>
  async () => ({
    query: async (sql) => {
      if (refuse?.test(sql)) throw Object.assign(new Error('The SELECT permission was denied on the object'), { number: 229 });
      const q = queries.find((x) => x.text === sql);
      if (!q) throw new Error(`No recording for: ${sql}`);
      return { rows: q.rows.map((row) => row.map(revive)), fields: q.fields };
    },
    end: async () => undefined,
  });

const connection: Connection = { id: 'c', name: 'shop', driver: 'sqlserver', via: 'local', settings: { host: 'localhost', port: 1433, database: 'shop', user: 'sa' }, auth: 'password' };
const ctx = { connection, secret: 'pw' };

describe('the SQL Server driver', () => {
  it('tests, catalogues and documents the shop as a SQL Server 2022 answers', async () => {
    const c = sqlserverConnector(replay());
    expect(await c.test(ctx)).toEqual(recorded.test);
    expect(await c.catalog(ctx)).toEqual(recorded.catalog);
    expect(await c.document!(ctx)).toEqual(recorded.detail);
  });

  it('reads a table as an Arrow stream with the loader’s types, money as a four-place decimal', async () => {
    const c = sqlserverConnector(replay());
    const r = await c.read(ctx, { table: { name: 'orders' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(r.columns).toEqual([
      { name: 'id', sqlType: 'INTEGER' },
      { name: 'customer_id', sqlType: 'INTEGER' },
      { name: 'total', sqlType: 'DECIMAL(10,2)' },
      { name: 'placed_at', sqlType: 'TIMESTAMP' },
      { name: 'status', sqlType: 'VARCHAR' },
      { name: 'paid', sqlType: 'DECIMAL(19,4)' },
    ]);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('total')!.toArray()).toEqual(['19.99', '5.50', '120.00', '42.25']);
    expect(t.getChild('paid')!.toArray()).toEqual(['19.9900', null, '120.0000', null]);
    expect(Number(t.getChild('id')!.get(0))).toBe(101);
    expect(Number(t.getChild('placed_at')!.get(0))).toBe(Date.UTC(2024, 3, 1, 9, 30));
  });

  it('reads a query bounded by SET ROWCOUNT, typed from its result columns', async () => {
    const c = sqlserverConnector(replay());
    const r = await c.read(ctx, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(2);
    expect(r.columns.map((x) => x.sqlType)).toEqual(['VARCHAR', 'DECIMAL(10,2)', 'TIMESTAMP', 'VARCHAR', 'DATE', 'BOOLEAN']);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('active')!.get(0)).toBe(true);
    expect(Number(t.getChild('signed_up')!.get(0))).toBe(Date.UTC(2024, 0, 15));
  });

  it('refuses a statement that returned no rows, which a write would', async () => {
    const c = sqlserverConnector(replay());
    await expect(c.read(ctx, { query: "UPDATE customers SET name = 'x'" })).rejects.toThrow('That statement returned no rows to read; the connection only reads.');
  });

  it('still documents the tables where sys.* can’t be read', async () => {
    const c = sqlserverConnector(replay(/sys\./));
    const d = await c.document!(ctx);
    expect(d.tables.map((t) => t.name)).toEqual(['customers', 'order_totals', 'orders']);
    const orders = d.tables[2]!;
    expect(orders.indexes).toEqual([]);
    expect(orders.foreignKeys).toEqual([]);
    expect(orders.note).toBeUndefined();
    expect(orders.columns[0]).toMatchObject({ name: 'id', pk: false, increment: true, notNull: true });
    expect(d.tables[1]!.sql).toBeUndefined();
    expect((await c.catalog(ctx)).tables.find((t) => t.name === 'orders')!.rows).toBeUndefined();
  });

  it('needs a host, a database and a user (unless an Entra ID token signs in), and turns the settings into a client config', () => {
    expect(() => sqlserverConfigFor({ connection: { ...connection, settings: {} } })).toThrow(ConnectorError);
    expect(() => sqlserverConfigFor({ connection: { ...connection, settings: { host: 'db', database: 'shop' } } })).toThrow('Give the user name.');
    expect(sqlserverConfigFor(ctx)).toEqual({ host: 'localhost', port: 1433, database: 'shop', user: 'sa', password: 'pw', encrypt: true, trustCertificate: false });
    expect(sqlserverConfigFor({ connection: { ...connection, settings: { host: 'db', database: 'shop', user: 'kev', domain: 'CORP', sslVerify: false, encrypt: false } }, secret: 'pw' })).toEqual({ host: 'db', port: 1433, database: 'shop', user: 'kev', password: 'pw', domain: 'CORP', encrypt: false, trustCertificate: true });
    expect(sqlserverConfigFor({ connection: { ...connection, settings: { host: 'db', database: 'shop', entra: true } }, secret: 'tok' })).toEqual({ host: 'db', port: 1433, database: 'shop', user: '', password: 'tok', token: true, encrypt: true, trustCertificate: false });
  });

  it('says a failure in plain words without the password', () => {
    const config = sqlserverConfigFor(ctx);
    expect(sqlserverProblem(Object.assign(new Error('Failed to connect to localhost:1433 - Could not connect (sequence)'), { code: 'ESOCKET' }), config).message).toBe('Nothing answers at localhost:1433.');
    expect(sqlserverProblem(Object.assign(new Error("Login failed for user 'sa'."), { code: 'ELOGIN', number: 18456 }), config).message).toBe('The database refused the user name or password.');
    expect(sqlserverProblem(Object.assign(new Error('Cannot open database "shop" requested by the login.'), { number: 4060 }), config).message).toMatch(/no database called shop/);
    expect(sqlserverProblem(new Error('self signed certificate'), config).message).toMatch(/certificate/);
    expect(sqlserverProblem(new Error("Invalid object name 'nothing'."), config).message).toBe("The database answered: Invalid object name 'nothing'.");
    expect(shortVersion('16.0.4305.5', 'Developer Edition (64-bit)')).toBe('SQL Server 16.0.4305 (Developer Edition (64-bit))');
    expect(shortVersion('15.0.2000.5')).toBe('SQL Server 15.0.2000');
  });

  it('closes the connection when a read is cancelled, which ends the query', async () => {
    let ended = false;
    const hanging: SqlserverClientLike = {
      query: () =>
        new Promise((_, reject) => {
          const tick = setInterval(() => {
            if (ended) {
              clearInterval(tick);
              reject(new Error('Connection closed'));
            }
          }, 5);
        }),
      end: async () => {
        ended = true;
      },
    };
    const c = sqlserverConnector(async () => hanging);
    const controller = new AbortController();
    const read = c.read({ ...ctx, signal: controller.signal }, { table: { name: 'orders' } });
    setTimeout(() => controller.abort(), 20);
    await expect(read).rejects.toThrow('The read was cancelled.');
    expect(ended).toBe(true);
  });

  it('writes the SQL of a read in Transact-SQL, reads defaults, and makes the client’s values plain', () => {
    expect(readSql({ table: { name: 'orders' } })).toBe('SELECT * FROM [dbo].[orders]');
    expect(readSql({ table: { schema: 'sales', name: 'or]ders' }, limit: 5 })).toBe('SELECT TOP (5) * FROM [sales].[or]]ders]');
    expect(readSql({ query: 'SELECT 1 AS n; ', limit: 2 })).toBe('SET ROWCOUNT 2;\nBEGIN TRANSACTION;\nSELECT 1 AS n;\nROLLBACK TRANSACTION');
    expect(readSql({ query: 'SELECT 1 AS n' })).toBe('BEGIN TRANSACTION;\nSELECT 1 AS n;\nROLLBACK TRANSACTION');
    expect(sqlserverDefault("('placed')")).toBe("'placed'");
    expect(sqlserverDefault('((1))')).toBe('1');
    expect(sqlserverDefault('(getdate())')).toBe('getdate()');
    expect(sqlserverDefault(null)).toBeUndefined();
    expect(plainValue({ type: { name: 'Date' } }, new Date(Date.UTC(2024, 0, 15)))).toBe('2024-01-15');
    expect(plainValue({ type: { name: 'DateTime2' } }, new Date(Date.UTC(2024, 3, 1, 9, 30)))).toBe('2024-04-01 09:30:00.000');
    expect(plainValue({ type: { name: 'Time' } }, new Date(Date.UTC(1970, 0, 1, 14, 0, 1)))).toBe('14:00:01.000');
    expect(plainValue({ type: { name: 'DateTimeOffset' } }, new Date(Date.UTC(2024, 3, 1, 9, 30)))).toBe('2024-04-01T09:30:00.000Z');
    expect(plainValue({ type: { name: 'DecimalN' }, scale: 2 }, 5.5)).toBe('5.50');
    expect(plainValue({ type: { name: 'MoneyN' } }, 19.99)).toBe('19.9900');
    expect(plainValue({ type: { name: 'Int' } }, 7)).toBe(7);
    expect(plainValue({ type: { name: 'VarBinary' } }, Buffer.from([1, 2]))).toEqual(new Uint8Array([1, 2]));
    expect(plainValue({ type: { name: 'VarChar' } }, null)).toBeNull();
  });
});
