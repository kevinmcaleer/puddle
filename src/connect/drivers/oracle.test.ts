// The Oracle driver against the queries an Oracle Database 23ai answers (tests/fixtures/db/oracle/, regenerated with
// scripts/record-database.mjs oracle <url>), and against a server that refuses a part.
import { tableFromIPC } from 'apache-arrow';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Connection } from '../../model';
import { ConnectorError } from '../types';
import { oracleConfigFor, oracleConnector, oracleDefault, oracleProblem, plainValue, readSql, shortVersion, type OracleClientLike, type OracleConnect, type OracleField } from './oracle';

interface Recorded {
  text: string;
  rows: unknown[][];
  fields: OracleField[];
}

const fixtures = join(__dirname, '../../../tests/fixtures/db/oracle');
const queries = JSON.parse(readFileSync(join(fixtures, 'queries.json'), 'utf8')) as Recorded[];
const recorded = JSON.parse(readFileSync(join(fixtures, 'catalog.json'), 'utf8')) as { test: unknown; catalog: unknown; detail: unknown };

const revive = (v: unknown): unknown => (v && typeof v === 'object' && 'bytes' in v ? new Uint8Array(Buffer.from((v as { bytes: string }).bytes, 'base64')) : v);

/** A client that answers each statement as the real server did; `refuse` makes it fail the ones an older release or a lesser user hasn't got. */
export const replay =
  (refuse?: RegExp): OracleConnect =>
  async () => ({
    query: async (sql) => {
      if (refuse?.test(sql)) throw Object.assign(new Error('ORA-00904: "TEXT_VC": invalid identifier'), { errorNum: 904 });
      const q = queries.find((x) => x.text === sql);
      if (!q) throw new Error(`No recording for: ${sql}`);
      return { rows: q.rows.map((row) => row.map(revive)), fields: q.fields };
    },
    end: async () => undefined,
  });

const connection: Connection = { id: 'c', name: 'shop', driver: 'oracle', via: 'local', settings: { host: 'localhost', port: 1521, service: 'FREEPDB1', user: 'shop' }, auth: 'password' };
const ctx = { connection, secret: 'pw' };

describe('the Oracle driver', () => {
  it('tests, catalogues and documents the shop as an Oracle Database 23ai answers', async () => {
    const c = oracleConnector(replay());
    expect(await c.test(ctx)).toEqual(recorded.test);
    expect(await c.catalog(ctx)).toEqual(recorded.catalog);
    expect(await c.document!(ctx)).toEqual(recorded.detail);
  });

  it('reads a table as an Arrow stream with NUMBER held by its scale', async () => {
    const c = oracleConnector(replay());
    const r = await c.read(ctx, { table: { name: 'ORDERS' }, limit: 10 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(4);
    expect(r.columns).toEqual([
      { name: 'ID', sqlType: 'BIGINT' },
      { name: 'CUSTOMER_ID', sqlType: 'BIGINT' },
      { name: 'TOTAL', sqlType: 'DECIMAL(10,2)' },
      { name: 'PLACED_AT', sqlType: 'TIMESTAMP' },
      { name: 'STATUS', sqlType: 'VARCHAR' },
    ]);
    const t = tableFromIPC(r.ipc);
    expect(t.getChild('TOTAL')!.toArray()).toEqual(['19.99', '5.5', '120', '42.25']);
    expect(Number(t.getChild('ID')!.get(0))).toBe(101);
    expect(Number(t.getChild('PLACED_AT')!.get(0))).toBe(Date.UTC(2024, 3, 1, 9, 30));
  });

  it('reads a query as an inline view, typed from its result columns, a DATE as a timestamp and NUMBER(1) as a whole number', async () => {
    const c = oracleConnector(replay());
    const r = await c.read(ctx, { query: 'SELECT c.name, o.total, o.placed_at, o.status, c.signed_up, c.active FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', limit: 2 });
    if (!('ipc' in r)) throw new Error('expected a stream');
    expect(r.rows).toBe(2);
    expect(r.columns.map((x) => x.sqlType)).toEqual(['VARCHAR', 'DECIMAL(10,2)', 'TIMESTAMP', 'VARCHAR', 'TIMESTAMP', 'INTEGER']);
    const t = tableFromIPC(r.ipc);
    expect(Number(t.getChild('ACTIVE')!.get(0))).toBe(1);
    expect(Number(t.getChild('SIGNED_UP')!.get(0))).toBe(Date.UTC(2024, 0, 15));
  });

  it('falls back to the LONG view text on a release without TEXT_VC, and still documents the tables where the constraints can’t be read', async () => {
    const c = oracleConnector(replay(/TEXT_VC|ALL_CONSTRAINTS|ALL_INDEXES/));
    const d = await c.document!(ctx);
    expect(d.tables.map((t) => t.name)).toEqual(['CUSTOMERS', 'ORDERS', 'ORDER_TOTALS']);
    const orders = d.tables[1]!;
    expect(orders.indexes).toEqual([]);
    expect(orders.foreignKeys).toEqual([]);
    expect(orders.columns[0]).toMatchObject({ name: 'ID', pk: false, increment: true, notNull: true });
    expect(d.tables[2]!.sql).toMatch(/customers/i);
  });

  it('needs a host, a service and a user, and turns the settings into a client config', () => {
    expect(() => oracleConfigFor({ connection: { ...connection, settings: {} } })).toThrow(ConnectorError);
    expect(() => oracleConfigFor({ connection: { ...connection, settings: { host: 'db', user: 'kev' } } })).toThrow('Give the service name.');
    expect(oracleConfigFor({ connection: { ...connection, settings: { host: 'db', service: 'ORCL', user: 'kev' } }, secret: 'pw' })).toEqual({ host: 'db', port: 1521, service: 'ORCL', user: 'kev', password: 'pw' });
    expect(oracleConfigFor(ctx)).toEqual({ host: 'localhost', port: 1521, service: 'FREEPDB1', user: 'shop', password: 'pw' });
  });

  it('says a failure in plain words without the password', () => {
    const config = oracleConfigFor(ctx);
    expect(oracleProblem(Object.assign(new Error('NJS-511: connection to host localhost port 1521 refused'), { code: 'NJS-511' }), config).message).toBe('Nothing answers at localhost:1521.');
    expect(oracleProblem(Object.assign(new Error('ORA-01017: invalid username/password; logon denied'), { errorNum: 1017 }), config).message).toBe('The database refused the user name or password.');
    expect(oracleProblem(Object.assign(new Error('ORA-12514: Cannot connect to database. Service FREEPDB1 is not registered'), { errorNum: 12514 }), config).message).toBe('There is no service called FREEPDB1 at localhost:1521.');
    expect(oracleProblem(Object.assign(new Error('ORA-01456: may not perform insert/delete/update operation inside a READ ONLY transaction'), { errorNum: 1456 }), config).message).toBe('The connection is read-only, so that statement can’t run.');
    expect(oracleProblem(new Error('ORA-00942: table or view does not exist'), config).message).toBe('The database answered: ORA-00942: table or view does not exist');
    expect(shortVersion('23.0.0.0.0')).toBe('Oracle Database 23.0.0');
    expect(shortVersion('Oracle Database 19c Enterprise Edition Release 19.0.0.0.0')).toBe('Oracle Database 19.0.0');
  });

  it('closes the connection when a read is cancelled, which ends the query', async () => {
    let ended = false;
    const hanging: OracleClientLike = {
      query: () =>
        new Promise((_, reject) => {
          const tick = setInterval(() => {
            if (ended) {
              clearInterval(tick);
              reject(new Error('NJS-500: connection to the Oracle Database was broken'));
            }
          }, 5);
        }),
      end: async () => {
        ended = true;
      },
    };
    const c = oracleConnector(async () => hanging);
    const controller = new AbortController();
    const read = c.read({ ...ctx, signal: controller.signal }, { table: { name: 'ORDERS' } });
    setTimeout(() => controller.abort(), 20);
    await expect(read).rejects.toThrow('The read was cancelled.');
    expect(ended).toBe(true);
  });

  it('writes the SQL of a read in Oracle’s dialect, reads defaults, and makes the client’s values plain', () => {
    expect(readSql({ table: { name: 'ORDERS' } })).toBe('SELECT * FROM "ORDERS"');
    expect(readSql({ table: { schema: 'SHOP', name: 'or"ders' }, limit: 5 })).toBe('SELECT * FROM "SHOP"."or""ders" FETCH FIRST 5 ROWS ONLY');
    expect(readSql({ query: 'SELECT 1 FROM DUAL; ', limit: 2 })).toBe('SELECT * FROM (SELECT 1 FROM DUAL) puddle_query FETCH FIRST 2 ROWS ONLY');
    expect(oracleDefault("'placed' ")).toBe("'placed'");
    expect(oracleDefault('SYSDATE')).toBe('SYSDATE');
    expect(oracleDefault(null)).toBeUndefined();
    expect(plainValue('DATE', new Date(2024, 0, 15))).toBe('2024-01-15 00:00:00.000');
    expect(plainValue('TIMESTAMP', new Date(2024, 3, 1, 9, 30))).toBe('2024-04-01 09:30:00.000');
    expect(plainValue('TIMESTAMP WITH TIME ZONE', new Date(Date.UTC(2024, 3, 1, 9, 30)))).toBe('2024-04-01T09:30:00.000Z');
    expect(plainValue('NUMBER', '19.99')).toBe('19.99');
    expect(plainValue('BLOB', Buffer.from([1, 2]))).toEqual(new Uint8Array([1, 2]));
    expect(plainValue('VARCHAR2', null)).toBeNull();
  });
});
