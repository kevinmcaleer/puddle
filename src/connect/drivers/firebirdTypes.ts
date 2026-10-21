// Firebird's types as Puddle loads them: the Arrow type the values cross in and the DuckDB type the table is created
// with, from a result field (the SQL type code node-firebird reports) or an RDB$FIELDS row. Pure, so the mapping is
// tested without a server. Values arrive from the client as text (dates, timestamps, fixed-point numbers), numbers,
// booleans or bytes, and `convertFirebirdValue` turns them into what src/excel/arrow.ts expects.
import type { SheetColumn, SheetColumnType } from '../../excel/types';
import { dateDays, timestampMs } from './pgTypes';

export interface FirebirdType {
  type: SheetColumnType;
  sqlType: string;
}

/** The SQL type codes a result field carries (Firebird's SQL_* dtypes). */
export const SQL_CODES = {
  TEXT: 452,
  VARYING: 448,
  SHORT: 500,
  LONG: 496,
  FLOAT: 482,
  DOUBLE: 480,
  D_FLOAT: 530,
  TIMESTAMP: 510,
  BLOB: 520,
  ARRAY: 540,
  QUAD: 550,
  TIME: 560,
  DATE: 570,
  INT64: 580,
  INT128: 32752,
  TIMESTAMP_TZ: 32754,
  TIMESTAMP_TZ_EX: 32748,
  TIME_TZ: 32756,
  TIME_TZ_EX: 32750,
  DEC16: 32760,
  DEC34: 32762,
  BOOLEAN: 32764,
  NULL: 32766,
} as const;

/** The field type codes RDB$FIELDS carries. */
export const FIELD_TYPES = {
  SHORT: 7,
  LONG: 8,
  FLOAT: 10,
  DATE: 12,
  TIME: 13,
  CHAR: 14,
  INT64: 16,
  BOOLEAN: 23,
  DEC16: 24,
  DEC34: 25,
  INT128: 26,
  DOUBLE: 27,
  TIME_TZ: 28,
  TIMESTAMP_TZ: 29,
  TIMESTAMP: 35,
  VARCHAR: 37,
  BLOB: 261,
} as const;

/** A result field as node-firebird describes it (withMeta). */
export interface FirebirdField {
  alias: string;
  type: number;
  subType: number | null;
  scale: number;
  length: number;
  field?: string;
  relation?: string;
}

const TEXT: FirebirdType = { type: 'VARCHAR', sqlType: 'VARCHAR' };
const decimal = (precision: number, scale: number): FirebirdType => ({ type: 'VARCHAR', sqlType: `DECIMAL(${precision},${scale})` });

/** The type of a query's result field. A negative scale is a fixed-point number held in the integer type. */
export function firebirdFieldType(f: FirebirdField): FirebirdType {
  const scale = f.scale < 0 ? -f.scale : 0;
  switch (f.type) {
    case SQL_CODES.SHORT:
      return scale ? decimal(4, scale) : { type: 'BIGINT', sqlType: 'SMALLINT' };
    case SQL_CODES.LONG:
      return scale ? decimal(9, scale) : { type: 'BIGINT', sqlType: 'INTEGER' };
    case SQL_CODES.INT64:
      return scale ? decimal(18, scale) : { type: 'BIGINT', sqlType: 'BIGINT' };
    case SQL_CODES.INT128:
      return decimal(38, scale);
    case SQL_CODES.FLOAT:
      return { type: 'DOUBLE', sqlType: 'FLOAT' };
    case SQL_CODES.DOUBLE:
    case SQL_CODES.D_FLOAT:
    case SQL_CODES.DEC16:
    case SQL_CODES.DEC34:
      return { type: 'DOUBLE', sqlType: 'DOUBLE' };
    case SQL_CODES.DATE:
      return { type: 'DATE', sqlType: 'DATE' };
    case SQL_CODES.TIMESTAMP:
      return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP' };
    case SQL_CODES.TIMESTAMP_TZ:
    case SQL_CODES.TIMESTAMP_TZ_EX:
      return { type: 'VARCHAR', sqlType: 'TIMESTAMP WITH TIME ZONE' };
    case SQL_CODES.TIME:
    case SQL_CODES.TIME_TZ:
    case SQL_CODES.TIME_TZ_EX:
      return { type: 'VARCHAR', sqlType: 'TIME' };
    case SQL_CODES.BOOLEAN:
      return { type: 'BOOLEAN', sqlType: 'BOOLEAN' };
    case SQL_CODES.BLOB:
      return f.subType === 1 ? TEXT : { type: 'BLOB', sqlType: 'BLOB' };
    default:
      return TEXT;
  }
}

/** A column as RDB$RELATION_FIELDS joined to RDB$FIELDS describes it. */
export interface FirebirdColumnRow {
  FIELD_TYPE: number;
  SUB_TYPE: number | null;
  FIELD_SCALE: number | null;
  FIELD_PRECISION: number | null;
  FIELD_LENGTH: number | null;
  CHARS: number | null;
}

const STORAGE_DIGITS: Record<number, number> = { [FIELD_TYPES.SHORT]: 4, [FIELD_TYPES.LONG]: 9, [FIELD_TYPES.INT64]: 18, [FIELD_TYPES.INT128]: 38 };

/** The type of a catalogued column, and how its declaration reads (the DBML type). */
export function firebirdColumnType(c: FirebirdColumnRow): FirebirdType & { declared: string } {
  const scale = c.FIELD_SCALE && c.FIELD_SCALE < 0 ? -c.FIELD_SCALE : 0;
  const chars = c.CHARS ?? c.FIELD_LENGTH ?? 0;
  const fixed = (storage: number): FirebirdType & { declared: string } => {
    const precision = c.FIELD_PRECISION || STORAGE_DIGITS[storage]!;
    return { ...decimal(precision, scale), declared: `${c.SUB_TYPE === 2 ? 'DECIMAL' : 'NUMERIC'}(${precision},${scale})` };
  };
  switch (c.FIELD_TYPE) {
    case FIELD_TYPES.SHORT:
      return scale ? fixed(FIELD_TYPES.SHORT) : { type: 'BIGINT', sqlType: 'SMALLINT', declared: 'SMALLINT' };
    case FIELD_TYPES.LONG:
      return scale ? fixed(FIELD_TYPES.LONG) : { type: 'BIGINT', sqlType: 'INTEGER', declared: 'INTEGER' };
    case FIELD_TYPES.INT64:
      return scale ? fixed(FIELD_TYPES.INT64) : { type: 'BIGINT', sqlType: 'BIGINT', declared: 'BIGINT' };
    case FIELD_TYPES.INT128:
      return scale ? fixed(FIELD_TYPES.INT128) : { ...decimal(38, 0), declared: 'INT128' };
    case FIELD_TYPES.FLOAT:
      return { type: 'DOUBLE', sqlType: 'FLOAT', declared: 'FLOAT' };
    case FIELD_TYPES.DOUBLE:
      return { type: 'DOUBLE', sqlType: 'DOUBLE', declared: 'DOUBLE PRECISION' };
    case FIELD_TYPES.DEC16:
      return { type: 'DOUBLE', sqlType: 'DOUBLE', declared: 'DECFLOAT(16)' };
    case FIELD_TYPES.DEC34:
      return { type: 'DOUBLE', sqlType: 'DOUBLE', declared: 'DECFLOAT(34)' };
    case FIELD_TYPES.DATE:
      return { type: 'DATE', sqlType: 'DATE', declared: 'DATE' };
    case FIELD_TYPES.TIME:
      return { type: 'VARCHAR', sqlType: 'TIME', declared: 'TIME' };
    case FIELD_TYPES.TIME_TZ:
      return { type: 'VARCHAR', sqlType: 'TIME', declared: 'TIME WITH TIME ZONE' };
    case FIELD_TYPES.TIMESTAMP:
      return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP', declared: 'TIMESTAMP' };
    case FIELD_TYPES.TIMESTAMP_TZ:
      return { type: 'VARCHAR', sqlType: 'TIMESTAMP WITH TIME ZONE', declared: 'TIMESTAMP WITH TIME ZONE' };
    case FIELD_TYPES.CHAR:
      return { ...TEXT, declared: `CHAR(${chars})` };
    case FIELD_TYPES.VARCHAR:
      return { ...TEXT, declared: `VARCHAR(${chars})` };
    case FIELD_TYPES.BOOLEAN:
      return { type: 'BOOLEAN', sqlType: 'BOOLEAN', declared: 'BOOLEAN' };
    case FIELD_TYPES.BLOB:
      return c.SUB_TYPE === 1 ? { ...TEXT, declared: 'BLOB SUB_TYPE TEXT' } : { type: 'BLOB', sqlType: 'BLOB', declared: 'BLOB' };
    default:
      return { ...TEXT, declared: 'VARCHAR' };
  }
}

/** One value as the client gave it (text, a number, a boolean, bytes, or null) for its column's Arrow type. */
export function convertFirebirdValue(v: unknown, type: SheetColumnType): SheetColumn['values'][number] {
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
      return String(v);
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** A Date node-firebird made from the database's wall-clock value, written back as that wall-clock text. */
export function dateText(d: Date, kind: 'date' | 'time' | 'timestamp'): string {
  const ymd = `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  return kind === 'date' ? ymd : kind === 'time' ? hms : `${ymd} ${hms}`;
}
