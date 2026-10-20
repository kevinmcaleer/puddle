// Reading SQLite databases (also LibSQL files) with sql.js into typed columns. Runs in the SQLite worker
// (src/sqlite/worker.ts), and directly in tests and the runner.
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import type { SheetColumn } from '../excel/types';
import { SqliteError, type SqliteColumn, type SqliteData, type SqliteTableInfo } from './types';

/** Every SQLite database file starts with this. */
const MAGIC = 'SQLite format 3\0';
export const isSqlite = (data: Uint8Array) => data.length >= 16 && String.fromCharCode(...data.subarray(0, 16)) === MAGIC;

let sql: Promise<SqlJsStatic> | undefined;

/** sql.js, started once. `locateFile` says where its WASM is (the worker passes Vite's URL; Node finds its own). */
export function sqlJs(locateFile?: (file: string) => string): Promise<SqlJsStatic> {
  return (sql ??= initSqlJs(locateFile ? { locateFile } : {}));
}

export async function openDatabase(data: Uint8Array, locateFile?: (file: string) => string): Promise<Database> {
  if (!isSqlite(data)) throw new SqliteError('This file isn’t a SQLite database.');
  const SQL = await sqlJs(locateFile);
  try {
    return new SQL.Database(data);
  } catch (e) {
    throw new SqliteError(`This database can’t be opened (${e instanceof Error ? e.message : String(e)}).`);
  }
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** The database's tables and views (not SQLite's own), with their declared columns and row counts. */
export function listTables(db: Database): SqliteTableInfo[] {
  const out: SqliteTableInfo[] = [];
  const stmt = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name");
  try {
    while (stmt.step()) {
      const [name, type] = stmt.get() as [string, string];
      const columns = db.exec(`PRAGMA table_info(${quote(name)})`)[0]?.values.map((r) => ({ name: String(r[1]), type: String(r[2] ?? ''), notNull: r[3] === 1, pk: Number(r[5]) > 0 })) ?? [];
      let rows = 0;
      try {
        rows = Number(db.exec(`SELECT count(*) FROM ${quote(name)}`)[0]?.values[0]?.[0] ?? 0);
      } catch {
        // A view over something missing can't be counted; it is listed all the same.
      }
      out.push({ name, kind: type === 'view' ? 'view' : 'table', columns, rows });
    }
  } finally {
    stmt.free();
  }
  return out;
}

/**
 * The DuckDB type a declared SQLite type loads as, by SQLite's own affinity rules (INT anywhere is an integer, then
 * CHAR, CLOB or TEXT is text, BLOB or nothing is a blob, REAL, FLOA or DOUB is a double, else numeric). Dates and
 * times are text in SQLite, so they stay text and the Parse dates step reads them.
 */
export function duckType(declared: string): { type: SheetColumn['type']; sqlType: string } {
  const t = declared.toUpperCase();
  if (t.includes('INT')) return { type: 'BIGINT', sqlType: 'BIGINT' };
  if (t.includes('BOOL')) return { type: 'BOOLEAN', sqlType: 'BOOLEAN' };
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) return { type: 'VARCHAR', sqlType: 'VARCHAR' };
  if (t === '' || t.includes('BLOB')) return { type: 'VARCHAR', sqlType: 'VARCHAR' };
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return { type: 'DOUBLE', sqlType: 'DOUBLE' };
  if (t.includes('DATE') || t.includes('TIME')) return { type: 'VARCHAR', sqlType: 'VARCHAR' };
  const decimal = /^(?:DECIMAL|NUMERIC)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(t);
  if (decimal) return { type: 'VARCHAR', sqlType: `DECIMAL(${Math.min(Number(decimal[1]), 38)},${Number(decimal[2])})` };
  return { type: 'DOUBLE', sqlType: 'DOUBLE' };
}

/** A column's type from the values it holds, for a query (which declares none): integers, doubles, text, blobs or booleans. */
function inferType(values: SqlValue[]): SheetColumn['type'] {
  let kind: SheetColumn['type'] | undefined;
  for (const v of values) {
    if (v === null) continue;
    const k: SheetColumn['type'] = typeof v === 'number' ? (Number.isInteger(v) ? 'BIGINT' : 'DOUBLE') : typeof v === 'bigint' ? 'BIGINT' : v instanceof Uint8Array ? 'BLOB' : 'VARCHAR';
    if (!kind) kind = k;
    else if (kind !== k) {
      if ((kind === 'BIGINT' && k === 'DOUBLE') || (kind === 'DOUBLE' && k === 'BIGINT')) kind = 'DOUBLE';
      else return 'VARCHAR';
    }
  }
  return kind ?? 'VARCHAR';
}

/** One value as it crosses to DuckDB for its column's Arrow type. */
function convert(v: SqlValue, type: SheetColumn['type']): SheetColumn['values'][number] {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'BIGINT':
      return typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : null;
    case 'DOUBLE':
      return typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
    case 'BOOLEAN':
      return typeof v === 'number' ? v !== 0 : typeof v === 'string' ? /^(1|true|t|yes|y)$/i.test(v) : null;
    case 'BLOB':
      return v instanceof Uint8Array ? v : null;
    default:
      return v instanceof Uint8Array ? `0x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}` : String(v);
  }
}

/**
 * Read a table (by its declared types) or a query (typed from its values), at most `limit` rows. A query is run as
 * it is written; a table is `SELECT *` over it.
 */
export function readRows(db: Database, what: { table: string } | { query: string }, limit?: number): SqliteData {
  const declared = 'table' in what ? new Map((db.exec(`PRAGMA table_info(${quote(what.table)})`)[0]?.values ?? []).map((r) => [String(r[1]), duckType(String(r[2] ?? ''))])) : undefined;
  const sql = 'table' in what ? `SELECT * FROM ${quote(what.table)}` : what.query.trim().replace(/;\s*$/, '');
  if ('table' in what && !declared?.size) throw new SqliteError(`There is no table called ${what.table} in this database.`);
  let stmt;
  try {
    stmt = db.prepare(limit ? `SELECT * FROM (${sql}) LIMIT ${Math.max(1, Math.floor(limit))}` : sql);
  } catch (e) {
    throw new SqliteError(`SQLite can’t run that (${e instanceof Error ? e.message : String(e)}).`);
  }
  try {
    const names = stmt.getColumnNames();
    const raw: SqlValue[][] = names.map(() => []);
    let rows = 0;
    while (stmt.step()) {
      const row = stmt.get();
      for (let i = 0; i < names.length; i++) raw[i]!.push(row[i] ?? null);
      rows++;
    }
    const columns: SqliteColumn[] = names.map((name, i) => {
      const typed = declared?.get(name) ?? { type: inferType(raw[i]!), sqlType: '' };
      const type = typed.type;
      return { name, type, sqlType: typed.sqlType || type, values: raw[i]!.map((v) => convert(v, type)) };
    });
    return { columns, rows };
  } catch (e) {
    if (e instanceof SqliteError) throw e;
    throw new SqliteError(`SQLite can’t run that (${e instanceof Error ? e.message : String(e)}).`);
  } finally {
    stmt.free();
  }
}
