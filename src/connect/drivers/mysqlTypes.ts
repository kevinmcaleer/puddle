// The MySQL family's types (MySQL, MariaDB, TiDB) as Puddle loads them: the Arrow type the values cross in and the
// DuckDB type the table is created with, from a result field's type code and flags or an information_schema row.
// Pure, so the mapping is tested without a server. Values arrive as text (or bytes for binary columns) and
// `convertValue` turns them into what src/excel/arrow.ts expects.
import type { SheetColumn, SheetColumnType } from '../../excel/types';
import { dateDays, timestampMs } from './pgTypes';

export interface MysqlType {
  type: SheetColumnType;
  sqlType: string;
}

/** The type codes a result field carries (MySQL's enum_field_types). */
export const TYPE_CODES = {
  DECIMAL: 0,
  TINY: 1,
  SHORT: 2,
  LONG: 3,
  FLOAT: 4,
  DOUBLE: 5,
  NULL: 6,
  TIMESTAMP: 7,
  LONGLONG: 8,
  INT24: 9,
  DATE: 10,
  TIME: 11,
  DATETIME: 12,
  YEAR: 13,
  NEWDATE: 14,
  VARCHAR: 15,
  BIT: 16,
  JSON: 245,
  NEWDECIMAL: 246,
  ENUM: 247,
  SET: 248,
  TINY_BLOB: 249,
  MEDIUM_BLOB: 250,
  LONG_BLOB: 251,
  BLOB: 252,
  VAR_STRING: 253,
  STRING: 254,
  GEOMETRY: 255,
} as const;

export const UNSIGNED_FLAG = 32;
export const BINARY_FLAG = 128;
/** The character set number of binary strings: a BLOB or VARBINARY rather than a TEXT or VARCHAR. */
export const BINARY_CHARSET = 63;

const TEXT: MysqlType = { type: 'VARCHAR', sqlType: 'VARCHAR' };

/** A result field as mysql2 describes it. */
export interface MysqlField {
  name: string;
  columnType: number;
  columnLength: number;
  flags: number;
  decimals: number;
  characterSet?: number;
}

/** DECIMAL's precision from the field's display length: M + 1 for the point when D > 0, + 1 for the sign when signed. */
export function decimalPrecision(f: Pick<MysqlField, 'columnLength' | 'decimals' | 'flags'>): { precision: number; scale: number } {
  const precision = f.columnLength - (f.decimals > 0 ? 1 : 0) - (f.flags & UNSIGNED_FLAG ? 0 : 1);
  return { precision: Math.max(1, precision), scale: f.decimals };
}

const decimal = (precision: number | undefined, scale: number | undefined): MysqlType => (precision && precision <= 38 && scale !== undefined && scale <= precision ? { type: 'VARCHAR', sqlType: `DECIMAL(${precision},${scale})` } : { type: 'DOUBLE', sqlType: 'DOUBLE' });

/** The type of a query's result field. */
export function mysqlFieldType(f: MysqlField): MysqlType {
  const binary = f.characterSet === BINARY_CHARSET || (f.flags & BINARY_FLAG) !== 0;
  switch (f.columnType) {
    case TYPE_CODES.TINY:
      return f.columnLength === 1 ? { type: 'BOOLEAN', sqlType: 'BOOLEAN' } : { type: 'BIGINT', sqlType: 'SMALLINT' };
    case TYPE_CODES.SHORT:
    case TYPE_CODES.YEAR:
      return { type: 'BIGINT', sqlType: f.flags & UNSIGNED_FLAG ? 'INTEGER' : 'SMALLINT' };
    case TYPE_CODES.INT24:
    case TYPE_CODES.LONG:
      return { type: 'BIGINT', sqlType: f.flags & UNSIGNED_FLAG ? 'BIGINT' : 'INTEGER' };
    case TYPE_CODES.LONGLONG:
      return { type: 'BIGINT', sqlType: 'BIGINT' };
    case TYPE_CODES.FLOAT:
      return { type: 'DOUBLE', sqlType: 'FLOAT' };
    case TYPE_CODES.DOUBLE:
      return { type: 'DOUBLE', sqlType: 'DOUBLE' };
    case TYPE_CODES.DECIMAL:
    case TYPE_CODES.NEWDECIMAL: {
      const { precision, scale } = decimalPrecision(f);
      return decimal(precision, scale);
    }
    case TYPE_CODES.BIT:
      return f.columnLength === 1 ? { type: 'BOOLEAN', sqlType: 'BOOLEAN' } : { type: 'BIGINT', sqlType: 'BIGINT' };
    case TYPE_CODES.DATE:
    case TYPE_CODES.NEWDATE:
      return { type: 'DATE', sqlType: 'DATE' };
    case TYPE_CODES.DATETIME:
    case TYPE_CODES.TIMESTAMP:
      return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP' };
    case TYPE_CODES.JSON:
      return { type: 'VARCHAR', sqlType: 'JSON' };
    case TYPE_CODES.TINY_BLOB:
    case TYPE_CODES.MEDIUM_BLOB:
    case TYPE_CODES.LONG_BLOB:
    case TYPE_CODES.BLOB:
    case TYPE_CODES.VAR_STRING:
    case TYPE_CODES.STRING:
    case TYPE_CODES.VARCHAR:
      return binary ? { type: 'BLOB', sqlType: 'BLOB' } : TEXT;
    case TYPE_CODES.GEOMETRY:
      return { type: 'BLOB', sqlType: 'BLOB' };
    default:
      // TIME (a duration that may pass 24 hours, so not DuckDB's TIME), ENUM, SET and anything new are text.
      return TEXT;
  }
}

/** The type of a catalogued column from information_schema.COLUMNS. */
export function mysqlColumnType(c: { DATA_TYPE: string; COLUMN_TYPE: string; NUMERIC_PRECISION?: number | string | null; NUMERIC_SCALE?: number | string | null }): MysqlType {
  const t = c.DATA_TYPE.toLowerCase();
  const full = c.COLUMN_TYPE.toLowerCase();
  const unsigned = full.includes('unsigned');
  const n = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? undefined : Number(v));
  switch (t) {
    case 'tinyint':
      return full.startsWith('tinyint(1)') ? { type: 'BOOLEAN', sqlType: 'BOOLEAN' } : { type: 'BIGINT', sqlType: 'SMALLINT' };
    case 'smallint':
    case 'year':
      return { type: 'BIGINT', sqlType: unsigned ? 'INTEGER' : 'SMALLINT' };
    case 'mediumint':
    case 'int':
    case 'integer':
      return { type: 'BIGINT', sqlType: unsigned ? 'BIGINT' : 'INTEGER' };
    case 'bigint':
      return { type: 'BIGINT', sqlType: 'BIGINT' };
    case 'float':
      return { type: 'DOUBLE', sqlType: 'FLOAT' };
    case 'double':
    case 'real':
      return { type: 'DOUBLE', sqlType: 'DOUBLE' };
    case 'decimal':
    case 'numeric':
      return decimal(n(c.NUMERIC_PRECISION), n(c.NUMERIC_SCALE));
    case 'bit':
      return full === 'bit(1)' ? { type: 'BOOLEAN', sqlType: 'BOOLEAN' } : { type: 'BIGINT', sqlType: 'BIGINT' };
    case 'date':
      return { type: 'DATE', sqlType: 'DATE' };
    case 'datetime':
    case 'timestamp':
      return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP' };
    case 'json':
      return { type: 'VARCHAR', sqlType: 'JSON' };
    case 'binary':
    case 'varbinary':
    case 'tinyblob':
    case 'blob':
    case 'mediumblob':
    case 'longblob':
    case 'geometry':
    case 'point':
    case 'linestring':
    case 'polygon':
      return { type: 'BLOB', sqlType: 'BLOB' };
    default:
      return TEXT;
  }
}

/** A datetime as MySQL writes it to milliseconds; the zero date (0000-00-00) and a zero day or month are null. */
export function mysqlTimestampMs(text: string): number | null {
  if (/^0000-00-00/.test(text) || /-00(-| |$)/.test(text.slice(0, 10))) return null;
  return timestampMs(text);
}

export function mysqlDateDays(text: string): number | null {
  if (/^0000-00-00/.test(text) || /-00(-|$)/.test(text.slice(0, 10))) return null;
  return dateDays(text);
}

/** One value as the client gave it (text, bytes for binary columns, or null) for its column's Arrow type. */
export function convertMysqlValue(v: string | Uint8Array | null | undefined, type: SheetColumnType): SheetColumn['values'][number] {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) {
    if (type === 'BLOB') return v;
    if (type === 'BOOLEAN') return v.length ? v[v.length - 1] !== 0 : null;
    if (type === 'BIGINT') {
      let n = 0;
      for (const b of v) n = n * 256 + b;
      return Number.isSafeInteger(n) ? n : null;
    }
    return new TextDecoder().decode(v);
  }
  switch (type) {
    case 'BIGINT': {
      const n = Number(v);
      return Number.isSafeInteger(n) ? n : null;
    }
    case 'DOUBLE': {
      const n = Number(v);
      return Number.isNaN(n) ? null : n;
    }
    case 'BOOLEAN':
      return v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : null;
    case 'DATE':
      return mysqlDateDays(v);
    case 'TIMESTAMP':
      return mysqlTimestampMs(v);
    case 'BLOB':
      return new TextEncoder().encode(v);
    default:
      return v;
  }
}

/** The values of an ENUM or SET column from its COLUMN_TYPE: enum('placed','shipped') → placed, shipped. */
export function enumValues(columnType: string): string[] | undefined {
  const m = /^(enum|set)\((.*)\)$/i.exec(columnType.trim());
  if (!m) return undefined;
  const out: string[] = [];
  const re = /'((?:[^']|'')*)'/g;
  let v: RegExpExecArray | null;
  while ((v = re.exec(m[2]!))) out.push(v[1]!.replaceAll("''", "'"));
  return out;
}
