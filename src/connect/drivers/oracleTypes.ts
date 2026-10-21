// Oracle Database's types as Puddle loads them: the Arrow type the values cross in and the DuckDB type the table is
// created with, from a result column's metadata (as node-oracledb names it) or an ALL_TAB_COLUMNS row. Pure, so the
// mapping is tested without a server. NUMBER values arrive as text (exact, however many digits), dates and
// timestamps as wall-clock text, LOBs as text or bytes, and `convertOracleValue` turns them into what
// src/excel/arrow.ts expects.
import type { SheetColumn, SheetColumnType } from '../../excel/types';
import { dateDays, timestampMs } from './pgTypes';

export interface OracleType {
  type: SheetColumnType;
  sqlType: string;
}

/** A result column as node-oracledb describes it. An unconstrained NUMBER has no precision and a scale of -127. */
export interface OracleField {
  name: string;
  dbTypeName: string;
  precision?: number;
  scale?: number;
  byteSize?: number;
}

const TEXT: OracleType = { type: 'VARCHAR', sqlType: 'VARCHAR' };
const DOUBLE: OracleType = { type: 'DOUBLE', sqlType: 'DOUBLE' };

/** NUMBER(p,s) as DuckDB holds it: whole numbers in an integer type that fits, fractions as DECIMAL, unconstrained as DOUBLE. */
export function numberType(precision: number | null | undefined, scale: number | null | undefined): OracleType {
  if (!precision || precision > 38 || scale === null || scale === undefined || scale < 0) return DOUBLE;
  if (scale === 0) return precision <= 9 ? { type: 'BIGINT', sqlType: 'INTEGER' } : precision <= 18 ? { type: 'BIGINT', sqlType: 'BIGINT' } : { type: 'VARCHAR', sqlType: `DECIMAL(${precision},0)` };
  return { type: 'VARCHAR', sqlType: `DECIMAL(${precision},${scale})` };
}

/** The type of a data type's name, as both the result metadata and ALL_TAB_COLUMNS spell it (TIMESTAMP(6) WITH TIME ZONE and the like). */
export function oracleNamedType(name: string, precision?: number | null, scale?: number | null): OracleType {
  const t = name.toUpperCase().replace(/\(\d+\)/g, '').trim();
  if (t === 'NUMBER') return numberType(precision, scale);
  if (t === 'FLOAT' || t === 'BINARY_DOUBLE') return DOUBLE;
  if (t === 'BINARY_FLOAT') return { type: 'DOUBLE', sqlType: 'FLOAT' };
  if (t === 'DATE' || t === 'TIMESTAMP' || t === 'TIMESTAMP WITH LOCAL TIME ZONE') return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP' };
  if (t === 'TIMESTAMP WITH TIME ZONE') return { type: 'VARCHAR', sqlType: 'TIMESTAMP WITH TIME ZONE' };
  if (t.startsWith('INTERVAL')) return { type: 'VARCHAR', sqlType: 'INTERVAL' };
  if (t === 'RAW' || t === 'BLOB' || t === 'LONG RAW' || t === 'BFILE') return { type: 'BLOB', sqlType: 'BLOB' };
  if (t === 'JSON') return { type: 'VARCHAR', sqlType: 'JSON' };
  if (t === 'BOOLEAN') return { type: 'BOOLEAN', sqlType: 'BOOLEAN' };
  // VARCHAR2, NVARCHAR2, CHAR, NCHAR, CLOB, NCLOB, LONG, ROWID, UROWID, XMLTYPE and anything new are text.
  return TEXT;
}

/** The type of a query's result column. */
export function oracleFieldType(f: OracleField): OracleType {
  return oracleNamedType(f.dbTypeName, f.precision, f.scale);
}

/** A column as ALL_TAB_COLUMNS describes it. */
export interface OracleColumnRow {
  DATA_TYPE: string;
  DATA_LENGTH?: number | null;
  CHAR_LENGTH?: number | null;
  DATA_PRECISION?: number | null;
  DATA_SCALE?: number | null;
}

/** The type of a catalogued column, and how its declaration reads (the DBML type). */
export function oracleColumnType(c: OracleColumnRow): OracleType & { declared: string } {
  const t = c.DATA_TYPE.toUpperCase();
  const mapped = oracleNamedType(t, c.DATA_PRECISION, c.DATA_SCALE);
  let declared = t;
  if (t === 'NUMBER') declared = c.DATA_PRECISION ? `NUMBER(${c.DATA_PRECISION},${c.DATA_SCALE ?? 0})` : 'NUMBER';
  else if (/^(VARCHAR2|NVARCHAR2|CHAR|NCHAR)$/.test(t)) declared = `${t}(${c.CHAR_LENGTH || c.DATA_LENGTH || 0})`;
  else if (t === 'RAW') declared = `RAW(${c.DATA_LENGTH ?? 0})`;
  return { ...mapped, declared };
}

/** One value as the client gave it (text, a number, a boolean, bytes, or null) for its column's Arrow type. */
export function convertOracleValue(v: unknown, type: SheetColumnType): SheetColumn['values'][number] {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return type === 'BLOB' ? v : new TextDecoder().decode(v);
  switch (type) {
    case 'BIGINT': {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isSafeInteger(n) ? n : null;
    }
    case 'DOUBLE': {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isNaN(n) ? null : n;
    }
    case 'BOOLEAN':
      return typeof v === 'boolean' ? v : v === 1 || v === '1' || v === 'true' ? true : v === 0 || v === '0' || v === 'false' ? false : null;
    case 'DATE':
      return dateDays(String(v));
    case 'TIMESTAMP':
      return timestampMs(String(v));
    case 'BLOB':
      return new TextEncoder().encode(String(v));
    default:
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** A Date node-oracledb made from the database's wall-clock value, written back as that wall-clock text. */
export function localText(d: Date): string {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
