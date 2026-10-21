// Trino's (and Presto's) types as Puddle loads them: the Arrow type the values cross in and the DuckDB type the
// table is created with, from a type as Trino spells it (`varchar(10)`, `decimal(10,2)`, `timestamp(3)`,
// `array(varchar)`, `row(a integer, b varchar)`). Values arrive from the REST protocol as JSON: numbers, booleans,
// text (decimals and dates and times as text, varbinary as base64) or nested arrays and objects, and
// `convertTrinoValue` turns them into what src/excel/arrow.ts expects.
import type { SheetColumn, SheetColumnType } from '../../excel/types';
import { dateDays, timestampMs } from './pgTypes';
import { base64Bytes } from './http';

export interface TrinoType {
  type: SheetColumnType;
  sqlType: string;
}

const TEXT: TrinoType = { type: 'VARCHAR', sqlType: 'VARCHAR' };
const JSON_TEXT: TrinoType = { type: 'VARCHAR', sqlType: 'JSON' };

/** The type of a column or a result field, from Trino's spelling of it. */
export function trinoType(declared: string): TrinoType {
  const t = declared.trim().toLowerCase();
  const base = /^([a-z_ ]+?)(?:\(|$)/.exec(t)?.[1]?.trim() ?? t;
  if (t.endsWith('with time zone')) return t.startsWith('time ') || t.startsWith('time(') ? { type: 'VARCHAR', sqlType: 'TIME' } : { type: 'VARCHAR', sqlType: 'TIMESTAMP WITH TIME ZONE' };
  switch (base) {
    case 'tinyint':
    case 'smallint':
      return { type: 'BIGINT', sqlType: 'SMALLINT' };
    case 'integer':
      return { type: 'BIGINT', sqlType: 'INTEGER' };
    case 'bigint':
      return { type: 'BIGINT', sqlType: 'BIGINT' };
    case 'real':
      return { type: 'DOUBLE', sqlType: 'FLOAT' };
    case 'double':
      return { type: 'DOUBLE', sqlType: 'DOUBLE' };
    case 'decimal': {
      const args = /\(([^)]*)\)/.exec(t)?.[1]?.split(',').map((x) => Number(x.trim())) ?? [];
      const p = args[0] ?? 38;
      const s = args[1] ?? 0;
      return p <= 38 ? { type: 'VARCHAR', sqlType: `DECIMAL(${p},${s})` } : TEXT;
    }
    case 'boolean':
      return { type: 'BOOLEAN', sqlType: 'BOOLEAN' };
    case 'date':
      return { type: 'DATE', sqlType: 'DATE' };
    case 'timestamp':
      return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP' };
    case 'time':
      return { type: 'VARCHAR', sqlType: 'TIME' };
    case 'interval day to second':
    case 'interval year to month':
      return { type: 'VARCHAR', sqlType: 'INTERVAL' };
    case 'uuid':
      return { type: 'VARCHAR', sqlType: 'UUID' };
    case 'varbinary':
      return { type: 'BLOB', sqlType: 'BLOB' };
    case 'json':
    case 'array':
    case 'map':
    case 'row':
      return JSON_TEXT;
    default:
      // varchar, char, ipaddress, hyperloglog, geometry and anything new are text.
      return TEXT;
  }
}

/** One value as the REST protocol gives it for its column's Arrow type. */
export function convertTrinoValue(v: unknown, type: SheetColumnType): SheetColumn['values'][number] {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'BIGINT': {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isSafeInteger(n) ? n : null;
    }
    case 'DOUBLE': {
      const n = typeof v === 'number' ? v : v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : Number(v);
      return Number.isNaN(n) ? null : n;
    }
    case 'BOOLEAN':
      return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null;
    case 'DATE':
      return dateDays(String(v));
    case 'TIMESTAMP':
      return timestampMs(String(v));
    case 'BLOB':
      return typeof v === 'string' ? base64Bytes(v) : null;
    default:
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}
