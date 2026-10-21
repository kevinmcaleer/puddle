// The PostgreSQL family driver against the queries recorded from a real PostgreSQL 16 (tests/fixtures/db/postgres/,
// regenerated with scripts/record-database.mjs postgres <url>), and against a database that lacks what Redshift lacks.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Connection } from '../../model';
import { ConnectorError } from '../types';
import { indexColumns, pgArray, pgConfigFor, pgProblem, plainDefault, postgresConnector, readSql, shortVersion, type PgClientLike, type PgConnect } from './postgres';

interface Recorded {
  text: string;
  rowMode?: 'array';
  rows: unknown[];
  fields: { name: string; dataTypeID: number; dataTypeModifier: number }[];
}

const fixtures = join(__dirname, '../../../tests/fixtures/db/postgres');
const queries = JSON.parse(readFileSync(join(fixtures, 'queries.json'), 'utf8')) as Recorded[];
const recorded = JSON.parse(readFileSync(join(fixtures, 'catalog.json'), 'utf8')) as { test: unknown; catalog: unknown; detail: unknown };

/** A client that answers each query as the real server did; `refuse` makes it fail the queries a lesser database hasn't got. */
const replay =
  (refuse?: RegExp): PgConnect =>
  async () => ({
    query: async (text, rowMode) => {
      if (refuse?.test(text)) throw Object.assign(new Error(`relation does not exist`), { code: '42P01' });
      const q = queries.find((x) => x.text === text && x.rowMode === rowMode);
      if (!q) throw new Error(`No recording for: ${text}`);
      return { rows: q.rows, fields: q.fields };
    },
    end: async () => undefined,
  });

const connection: Connection = { id: 'c', name: 'shop', driver: 'postgres', via: 'local', settings: { host: '127.0.0.1', port: 54329, database: 'shop', user: 'postgres' }, auth: 'password' };
const ctx = { connection, secret: 'pw' };

describe('the PostgreSQL driver', () => {
  it('tests, catalogues and documents the shop as recorded from PostgreSQL 16', async () => {
    const c = postgresConnector('postgres', replay());
    expect(await c.test(ctx)).toEqual(recorded.test);
    expect(await c.catalog(ctx)).toEqual(recorded.catalog);
    expect(await c.document!(ctx)).toEqual(recorded.detail);
  });

  it('reads a table as an Arrow stream with the loader’s types', async () => {
    const c = postgresConnector('postgres', replay());
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
    expect(t.numRows).toBe(4);
    expect(t.getChild('total')!.toArray()).toEqual(['19.99', '5.50', '120.00', '42.25']);
    expect(t.getChild('status')!.get(0)).toBe('shipped');
    expect(Number(t.getChild('id')!.get(0))).toBe(101);
    // Arrow reads its microsecond timestamps back as milliseconds since the epoch, UTC.
    expect(Number(t.getChild('placed_at')!.get(0))).toBe(Date.UTC(2024, 3, 1, 9, 30));
  });

  it('reads a query, typed from its result fields, with dates and booleans converted', async () => {
    const c = postgresConnector('postgres', replay());
    const r = await c.read(ctx, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(2);
    expect(r.columns.map((x) => x.sqlType)).toEqual(['VARCHAR', 'DECIMAL(10,2)', 'TIMESTAMP', 'VARCHAR', 'DATE', 'BOOLEAN']);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('active')!.get(0)).toBe(true);
    expect(Number(t.getChild('signed_up')!.get(0))).toBe(Date.UTC(2024, 0, 15));
  });

  it('still documents tables, keys and foreign keys where the database has no comments, enums, identity columns or indexes (Redshift)', async () => {
    const c = postgresConnector('redshift', replay(/pg_description|pg_enum|pg_indexes|is_identity/));
    const d = await c.document!(ctx);
    expect(d.tables.map((t) => t.name)).toEqual(['customers', 'order_totals', 'orders']);
    expect(d.enums).toEqual([]);
    const orders = d.tables[2]!;
    expect(orders.indexes).toEqual([]);
    expect(orders.foreignKeys).toEqual([{ name: 'orders_customer_id_fkey', columns: ['customer_id'], refTable: 'customers', refColumns: ['id'] }]);
    expect(orders.columns[0]).toMatchObject({ name: 'id', pk: true, increment: true });
    expect(d.tables[0]!.note).toBeUndefined();
    expect(d.tables[0]!.columns[2]).toMatchObject({ name: 'email', unique: true });
  });

  it('needs a host, a database and a user, and turns the settings into a client config', () => {
    expect(() => pgConfigFor({ connection: { ...connection, settings: {} } })).toThrow(ConnectorError);
    expect(pgConfigFor({ connection: { ...connection, settings: { host: 'db', database: 'shop', user: 'kev', ssl: true } }, secret: 'pw' })).toEqual({ host: 'db', port: 5432, database: 'shop', user: 'kev', password: 'pw', ssl: { rejectUnauthorized: true } });
    expect(pgConfigFor({ connection: { ...connection, settings: { host: 'db', port: 5439, database: 'shop', user: 'kev', ssl: true, sslVerify: false } } }).ssl).toEqual({ rejectUnauthorized: false });
    expect(pgConfigFor(ctx).ssl).toBe(false);
  });

  it('says a failure in plain words without the password', () => {
    const config = pgConfigFor(ctx);
    expect(pgProblem(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), config).message).toBe('Nothing answers at 127.0.0.1:54329.');
    expect(pgProblem(Object.assign(new Error('password authentication failed for user "postgres"'), { code: '28P01' }), config).message).toBe('The database refused the user name or password.');
    expect(pgProblem(Object.assign(new Error('database "shop" does not exist'), { code: '3D000' }), config).message).toBe('There is no database called shop on 127.0.0.1.');
    expect(pgProblem(new Error('self signed certificate'), config).message).toMatch(/certificate/);
    expect(pgProblem(new Error('The server does not support SSL connections'), config).message).toMatch(/Use SSL/);
    expect(pgProblem(new Error('syntax error at or near "FROM"'), config).message).toBe('The database answered: syntax error at or near "FROM"');
  });

  it('reports a database that refuses the connection through the connector', async () => {
    const c = postgresConnector('postgres', async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    });
    await expect(c.test(ctx)).rejects.toThrow('Nothing answers at 127.0.0.1:54329.');
  });

  it('closes the connection when a read is cancelled, which ends the query', async () => {
    let ended = false;
    const hanging: PgClientLike = {
      query: (text) =>
        text.startsWith('SET')
          ? Promise.resolve({ rows: [], fields: [] })
          : new Promise((_, reject) => {
              const tick = setInterval(() => {
                if (ended) {
                  clearInterval(tick);
                  reject(new Error('Connection terminated'));
                }
              }, 5);
            }),
      end: async () => {
        ended = true;
      },
    };
    const c = postgresConnector('postgres', async () => hanging);
    const controller = new AbortController();
    const read = c.read({ ...ctx, signal: controller.signal }, { table: { name: 'orders' } });
    setTimeout(() => controller.abort(), 20);
    await expect(read).rejects.toThrow('The read was cancelled.');
    expect(ended).toBe(true);
  });

  it('writes the SQL of a read in PostgreSQL’s dialect, and reads the catalogue’s odd bits', () => {
    expect(readSql({ table: { name: 'orders' } })).toBe('SELECT * FROM "orders"');
    expect(readSql({ table: { schema: 'sales', name: 'or"ders' }, limit: 5 })).toBe('SELECT * FROM "sales"."or""ders" LIMIT 5');
    expect(readSql({ query: 'SELECT 1 ORDER BY 1; ', limit: 2 })).toBe('SELECT * FROM (SELECT 1 ORDER BY 1) AS puddle_query LIMIT 2');
    expect(indexColumns('CREATE INDEX orders_customer ON public.orders USING btree (customer_id, "placed_at" DESC)')).toEqual(['customer_id', 'placed_at']);
    expect(indexColumns('CREATE INDEX x ON t (lower(name))')).toEqual(['lower(name)']);
    expect(plainDefault("'placed'::order_status")).toBe("'placed'");
    expect(plainDefault("'2024-01-01'::date")).toBe("'2024-01-01'");
    expect(plainDefault('now()')).toBe('now()');
    expect(pgArray('{1,2}')).toEqual(['1', '2']);
    expect(pgArray(null)).toEqual([]);
    expect(shortVersion('PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc')).toBe('PostgreSQL 16.15');
    expect(shortVersion('CockroachDB CCL v24.1.0 (x86_64-pc-linux-gnu, built 2024/05/15)')).toBe('CockroachDB CCL v24.1.0');
  });
});
