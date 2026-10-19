// Reading Access databases (.mdb and .accdb) with mdb-reader into typed columns. Runs in the Access worker
// (src/access/worker.ts), and directly in tests.
import './buffer';
import { Buffer } from 'buffer';
import MDBReader from 'mdb-reader';
import type { Column, Value } from 'mdb-reader';
import { ENCRYPTED, AccessError, type AccessColumn, type AccessTableInfo } from './types';

/** Rows are read a page at a time, so a large table never becomes one array of row objects. */
const PAGE = 50_000;

/** Every Jet and ACE database starts with this page type and signature ("Standard Jet DB" or "Standard ACE DB"). */
const isAccess = (data: Uint8Array) => data[0] === 0 && data[1] === 1 && data[2] === 0 && data[3] === 0 && /^Standard (Jet|ACE) DB/.test(String.fromCharCode(...data.subarray(4, 19)));

/** Open a database's bytes, saying plainly why it can't be read. */
export function openDatabase(data: Uint8Array): MDBReader {
  if (!isAccess(data)) throw new AccessError('This file isn’t an Access database. Save it from Access as .accdb or .mdb, or export the tables as CSV.');
  try {
    return new MDBReader(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  } catch (e) {
    throw failure(e);
  }
}

/** A failure inside mdb-reader in plain words. Encryption needs a password (or, in the browser, crypto Puddle leaves out). */
function failure(e: unknown): AccessError {
  if (e instanceof AccessError) return e;
  const why = e instanceof Error ? e.message : String(e);
  if (/password|encrypt/i.test(why)) return new AccessError(ENCRYPTED);
  return new AccessError(`This database can’t be read (${why}). Open it in Access, run Compact and Repair, and add it again.`);
}

/** The database's own tables (not system or linked ones), in the order Access keeps them, with their sizes. */
export function listTables(db: MDBReader): AccessTableInfo[] {
  try {
    return db.getTableNames().map((name) => {
      const t = db.getTable(name);
      return { name, rows: t.rowCount, columns: t.columnCount };
    });
  } catch (e) {
    throw failure(e);
  }
}

/** The DuckDB type each Access column type is loaded as, and how its values travel to DuckDB. */
function typesOf(c: Column): Pick<AccessColumn, 'type' | 'sqlType'> {
  switch (c.type) {
    case 'boolean':
      return { type: 'BOOLEAN', sqlType: 'BOOLEAN' };
    case 'byte':
      return { type: 'BIGINT', sqlType: 'UTINYINT' };
    case 'integer':
      return { type: 'BIGINT', sqlType: 'SMALLINT' };
    case 'long':
      return { type: 'BIGINT', sqlType: 'INTEGER' };
    case 'bigint':
      return { type: 'VARCHAR', sqlType: 'BIGINT' };
    case 'float':
      return { type: 'DOUBLE', sqlType: 'FLOAT' };
    case 'double':
      return { type: 'DOUBLE', sqlType: 'DOUBLE' };
    // Currency and Decimal come as exact text; DuckDB turns it into a decimal without rounding through a double.
    case 'currency':
      return { type: 'VARCHAR', sqlType: 'DECIMAL(19,4)' };
    case 'numeric': {
      const precision = Math.min(Math.max(c.precision ?? 18, 1), 38);
      return { type: 'VARCHAR', sqlType: `DECIMAL(${precision},${Math.min(c.scale ?? 0, precision)})` };
    }
    case 'datetime':
      return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP' };
    case 'binary':
    case 'ole':
      return { type: 'BLOB', sqlType: 'BLOB' };
    default:
      // Text, Long Text, GUIDs, attachments (as their file names) and extended dates (as Access writes them).
      return { type: 'VARCHAR', sqlType: 'VARCHAR' };
  }
}

/** One value as it crosses to DuckDB for its column's Arrow type. */
function valueOf(v: Value, type: AccessColumn['type']): AccessColumn['values'][number] {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (Array.isArray(v)) return v.map((a) => a.name).join(', ');
  if (v instanceof Uint8Array) return type === 'BLOB' ? new Uint8Array(v) : null;
  if (typeof v === 'bigint') return String(v);
  return v;
}

/** Read one table (the first when none is named) into typed columns. */
export function readTable(db: MDBReader, name?: string): { table: string; columns: AccessColumn[]; rows: number } {
  const tables = listTables(db);
  if (!tables.length) throw new AccessError('This database has no tables.');
  const table = name ?? tables[0]!.name;
  if (!tables.some((t) => t.name === table)) throw new AccessError(`There is no table called ${table} in this database. Choose another table.`);
  try {
    const t = db.getTable(table);
    const columns: AccessColumn[] = t.getColumns().map((c) => ({ name: c.name, ...typesOf(c), values: [] }));
    const names = columns.map((c) => c.name);
    for (let offset = 0; offset < t.rowCount; offset += PAGE) {
      for (const row of t.getData({ columns: names, rowOffset: offset, rowLimit: PAGE })) for (const c of columns) c.values.push(valueOf(row[c.name] ?? null, c.type));
    }
    return { table, columns, rows: columns[0]?.values.length ?? 0 };
  } catch (e) {
    throw failure(e);
  }
}
