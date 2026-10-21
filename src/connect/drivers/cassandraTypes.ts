// CQL types as DuckDB holds them: by the type codes a result describes its columns with, and by the type text
// system_schema.columns declares (`frozen<list<text>>`, `map<text, int>`, a user-defined type's name). Collections,
// tuples, user-defined types and vectors arrive as JSON text; a varint as a HUGEINT, a decimal as DECIMAL(38,9),
// a uuid as UUID, a time as TIME, each crossing Arrow as text and cast on load.
import type { SheetColumnType } from '../../excel/types';

/** The type codes of the native protocol. */
export const CQL_CODES: Record<number, string> = {
  0: 'custom',
  1: 'ascii',
  2: 'bigint',
  3: 'blob',
  4: 'boolean',
  5: 'counter',
  6: 'decimal',
  7: 'double',
  8: 'float',
  9: 'int',
  10: 'text',
  11: 'timestamp',
  12: 'uuid',
  13: 'varchar',
  14: 'varint',
  15: 'timeuuid',
  16: 'inet',
  17: 'date',
  18: 'time',
  19: 'smallint',
  20: 'tinyint',
  21: 'duration',
  32: 'list',
  33: 'map',
  34: 'set',
  48: 'udt',
  49: 'tuple',
};

export interface CqlType {
  /** How the column crosses Arrow. */
  type: SheetColumnType;
  /** The DuckDB type it is cast to on load. */
  sqlType: string;
  /** The type as declared. */
  declared: string;
}

const VARCHAR = (sqlType = 'VARCHAR'): Pick<CqlType, 'type' | 'sqlType'> => ({ type: 'VARCHAR', sqlType });

/** A built-in type by name. Anything else (a user-defined type) is JSON. */
export function cqlNamedType(name: string): Pick<CqlType, 'type' | 'sqlType'> {
  switch (name.toLowerCase()) {
    case 'ascii':
    case 'text':
    case 'varchar':
    case 'inet':
    case 'duration':
      return VARCHAR();
    case 'bigint':
    case 'counter':
      return { type: 'BIGINT', sqlType: 'BIGINT' };
    case 'int':
      return { type: 'BIGINT', sqlType: 'INTEGER' };
    case 'smallint':
      return { type: 'BIGINT', sqlType: 'SMALLINT' };
    case 'tinyint':
      return { type: 'BIGINT', sqlType: 'TINYINT' };
    case 'varint':
      return VARCHAR('HUGEINT');
    case 'decimal':
      return VARCHAR('DECIMAL(38,9)');
    case 'double':
      return { type: 'DOUBLE', sqlType: 'DOUBLE' };
    case 'float':
      return { type: 'DOUBLE', sqlType: 'FLOAT' };
    case 'boolean':
      return { type: 'BOOLEAN', sqlType: 'BOOLEAN' };
    case 'timestamp':
      return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP' };
    case 'date':
      return { type: 'DATE', sqlType: 'DATE' };
    case 'time':
      return VARCHAR('TIME');
    case 'uuid':
    case 'timeuuid':
      return VARCHAR('UUID');
    case 'blob':
      return { type: 'BLOB', sqlType: 'BLOB' };
    default:
      return VARCHAR('JSON');
  }
}

/** A type as system_schema.columns declares it. */
export function cqlDeclaredType(declared: string): CqlType {
  const inner = declared.trim().replace(/^frozen<([\s\S]*)>$/i, '$1');
  const name = inner.split('<')[0]!.trim();
  return { ...cqlNamedType(name), declared: declared.trim() };
}

/** A result column's type, from the code the protocol describes it with. */
export function cqlFieldType(column: { type: { code: number } }): CqlType {
  const name = CQL_CODES[column.type.code] ?? 'custom';
  return { ...cqlNamedType(name === 'custom' ? 'text' : name), declared: name };
}

const DAY_MS = 86_400_000;

/**
 * A value as the client gives it, as plain JavaScript: the driver's Long, BigDecimal, Integer, LocalDate, LocalTime,
 * Uuid, InetAddress and Duration as their text, a Tuple or Vector as a list, a user-defined type as an object.
 */
export function plainCql(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (v instanceof Uint8Array) return new Uint8Array(v);
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(plainCql);
  if (v instanceof Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [String(k), plainCql(x)]));
  if (v instanceof Set) return [...v].map(plainCql);
  const ctor = (v as { constructor?: { name?: string } }).constructor?.name ?? '';
  if (['Long', 'BigDecimal', 'Integer', 'LocalDate', 'LocalTime', 'Uuid', 'TimeUuid', 'InetAddress', 'Duration'].includes(ctor)) return String(v);
  if (ctor === 'Tuple') return (v as { values(): unknown[] }).values().map(plainCql);
  if (typeof (v as Iterable<unknown>)[Symbol.iterator] === 'function') return [...(v as Iterable<unknown>)].map(plainCql);
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plainCql(x)]));
}

/** A plain value as its column's Arrow type takes it. */
export function convertCqlValue(v: unknown, type: SheetColumnType): number | string | boolean | Uint8Array | null {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'BIGINT':
      return typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : null;
    case 'DOUBLE':
      return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
    case 'BOOLEAN':
      return typeof v === 'boolean' ? v : null;
    case 'DATE': {
      const ms = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(`${v.slice(0, 10)}T00:00:00Z`) : NaN;
      return Number.isNaN(ms) ? null : Math.floor(ms / DAY_MS);
    }
    case 'TIMESTAMP': {
      const ms = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v : NaN;
      return Number.isNaN(ms) ? null : ms;
    }
    case 'BLOB':
      return v instanceof Uint8Array ? v : null;
    default:
      return v instanceof Date ? v.toISOString() : v instanceof Uint8Array ? `0x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}` : typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}
