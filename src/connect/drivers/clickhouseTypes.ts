// ClickHouse's types as Puddle loads them: the Arrow type the values cross in and the DuckDB type the table is created
// with, from a type as ClickHouse spells it (`Nullable(Decimal(10, 2))`, `LowCardinality(String)`, `Array(UInt8)`).
// Values arrive from JSONCompact as numbers, booleans, text (64-bit and wider integers and decimals are quoted so
// nothing is rounded, dates and times are text) or nested arrays and objects, and `convertClickhouseValue` turns
// them into what src/excel/arrow.ts expects.
import type { SheetColumn, SheetColumnType } from '../../excel/types';
import { dateDays, timestampMs } from './pgTypes';

export interface ClickhouseType {
  type: SheetColumnType;
  sqlType: string;
}

const TEXT: ClickhouseType = { type: 'VARCHAR', sqlType: 'VARCHAR' };
const JSON_TEXT: ClickhouseType = { type: 'VARCHAR', sqlType: 'JSON' };

/** A type without its wrappers: `Nullable(LowCardinality(String))` is `String`. */
export function unwrap(type: string): string {
  let t = type.trim();
  for (;;) {
    const m = /^(Nullable|LowCardinality)\((.*)\)$/s.exec(t);
    if (!m) return t;
    t = m[2]!.trim();
  }
}

/** The type of a column or a result field, from ClickHouse's spelling of it. */
export function clickhouseType(declared: string): ClickhouseType {
  const t = unwrap(declared);
  const base = /^([A-Za-z0-9_]+)/.exec(t)?.[1] ?? t;
  switch (base) {
    case 'Int8':
    case 'Int16':
    case 'UInt8':
    case 'UInt16':
      return { type: 'BIGINT', sqlType: 'SMALLINT' };
    case 'Int32':
    case 'UInt32':
      return { type: 'BIGINT', sqlType: base === 'UInt32' ? 'BIGINT' : 'INTEGER' };
    case 'Int64':
      return { type: 'BIGINT', sqlType: 'BIGINT' };
    case 'UInt64':
    case 'Int128':
    case 'UInt128':
    case 'Int256':
    case 'UInt256':
      // Beyond what fits a signed 64-bit integer: kept as text, exact.
      return { type: 'VARCHAR', sqlType: base === 'UInt64' ? 'UBIGINT' : 'VARCHAR' };
    case 'Float32':
      return { type: 'DOUBLE', sqlType: 'FLOAT' };
    case 'Float64':
    case 'BFloat16':
      return { type: 'DOUBLE', sqlType: 'DOUBLE' };
    case 'Decimal':
    case 'Decimal32':
    case 'Decimal64':
    case 'Decimal128':
    case 'Decimal256': {
      const args = /\(([^)]*)\)/.exec(t)?.[1]?.split(',').map((x) => Number(x.trim())) ?? [];
      const [p, s] = base === 'Decimal' ? [args[0] ?? 10, args[1] ?? 0] : [{ Decimal32: 9, Decimal64: 18, Decimal128: 38, Decimal256: 76 }[base]!, args[0] ?? 0];
      return p <= 38 ? { type: 'VARCHAR', sqlType: `DECIMAL(${p},${s})` } : { type: 'VARCHAR', sqlType: 'VARCHAR' };
    }
    case 'Bool':
      return { type: 'BOOLEAN', sqlType: 'BOOLEAN' };
    case 'Date':
    case 'Date32':
      return { type: 'DATE', sqlType: 'DATE' };
    case 'DateTime':
    case 'DateTime64':
      // A zone in the type ("DateTime('UTC')") names the zone the text is written in; the text is loaded as it reads.
      return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP' };
    case 'Time':
    case 'Time64':
      return { type: 'VARCHAR', sqlType: 'TIME' };
    case 'UUID':
      return { type: 'VARCHAR', sqlType: 'UUID' };
    case 'Array':
    case 'Tuple':
    case 'Map':
    case 'Nested':
    case 'JSON':
    case 'Object':
    case 'Variant':
    case 'Dynamic':
    case 'Point':
    case 'Ring':
    case 'Polygon':
    case 'MultiPolygon':
    case 'LineString':
    case 'MultiLineString':
      return JSON_TEXT;
    case 'AggregateFunction':
    case 'SimpleAggregateFunction':
      return TEXT;
    default:
      // String, FixedString, Enum8, Enum16, IPv4, IPv6, Nothing and anything new are text.
      return TEXT;
  }
}

/** One value as JSONCompact gives it for its column's Arrow type. */
export function convertClickhouseValue(v: unknown, type: SheetColumnType): SheetColumn['values'][number] {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'BIGINT': {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isSafeInteger(n) ? n : null;
    }
    case 'DOUBLE': {
      // Infinity and NaN come as the strings "inf", "-inf" and "nan".
      const n = typeof v === 'number' ? v : v === 'inf' ? Infinity : v === '-inf' ? -Infinity : Number(v);
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
