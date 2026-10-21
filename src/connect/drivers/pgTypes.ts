// The PostgreSQL family's types (PostgreSQL, Amazon Redshift, CockroachDB, GreengageDB) as Puddle loads them: each
// column gets the Arrow type its values cross in and the DuckDB type the table is created with. Pure, so the
// mapping is tested without a server. Values arrive from the database as text (the driver asks for no parsing),
// and `convertValue` turns them into what src/excel/arrow.ts expects for the column's type.
import type { SheetColumn, SheetColumnType } from '../../excel/types';

export interface PgType {
  type: SheetColumnType;
  sqlType: string;
}

/** What a column's type is known by: its type name (information_schema's udt_name, or the name an OID resolves to) and its typmod or precision. */
export interface PgTypeName {
  name: string;
  /** NUMERIC's declared precision and scale, from information_schema or a typmod; absent when it has none. */
  precision?: number;
  scale?: number;
}

/** The built-in type OIDs a query's result fields carry (pg_type's fixed OIDs), by name. Anything else (an enum, an array, a user's type) is text. */
export const OID_NAMES: Record<number, string> = {
  16: 'bool',
  17: 'bytea',
  18: 'char',
  19: 'name',
  20: 'int8',
  21: 'int2',
  23: 'int4',
  25: 'text',
  26: 'oid',
  114: 'json',
  700: 'float4',
  701: 'float8',
  1042: 'bpchar',
  1043: 'varchar',
  1082: 'date',
  1083: 'time',
  1114: 'timestamp',
  1184: 'timestamptz',
  1186: 'interval',
  1266: 'timetz',
  1700: 'numeric',
  2950: 'uuid',
  3802: 'jsonb',
};

/** NUMERIC's precision and scale from its typmod (-1 when none was declared). */
export function numericTypmod(typmod: number): { precision: number; scale: number } | undefined {
  if (typmod < 4) return undefined;
  const v = typmod - 4;
  return { precision: (v >> 16) & 0xffff, scale: v & 0xffff };
}

const TEXT: PgType = { type: 'VARCHAR', sqlType: 'VARCHAR' };

/** The type a column loads as, by its PostgreSQL type name. Unknown names (enums, arrays, ranges, user types, geometry) load as text. */
export function pgType({ name, precision, scale }: PgTypeName): PgType {
  const n = name.toLowerCase().replace(/^pg_catalog\./, '');
  switch (n) {
    case 'int2':
    case 'smallint':
      return { type: 'BIGINT', sqlType: 'SMALLINT' };
    case 'int4':
    case 'integer':
    case 'int':
    case 'oid':
    case 'serial':
      return { type: 'BIGINT', sqlType: 'INTEGER' };
    case 'int8':
    case 'bigint':
    case 'bigserial':
      return { type: 'BIGINT', sqlType: 'BIGINT' };
    case 'float4':
    case 'real':
      return { type: 'DOUBLE', sqlType: 'FLOAT' };
    case 'float8':
    case 'double precision':
      return { type: 'DOUBLE', sqlType: 'DOUBLE' };
    case 'numeric':
    case 'decimal':
      // A declared precision keeps the number exact; without one the values are doubles, as DuckDB would read them.
      if (precision && precision <= 38 && scale !== undefined && scale >= 0 && scale <= precision) return { type: 'VARCHAR', sqlType: `DECIMAL(${precision},${scale})` };
      return { type: 'DOUBLE', sqlType: 'DOUBLE' };
    case 'bool':
    case 'boolean':
      return { type: 'BOOLEAN', sqlType: 'BOOLEAN' };
    case 'date':
      return { type: 'DATE', sqlType: 'DATE' };
    case 'timestamp':
    case 'timestamp without time zone':
      return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP' };
    case 'timestamptz':
    case 'timestamp with time zone':
      // Kept as text with its offset; DuckDB reads it into a TIMESTAMP WITH TIME ZONE.
      return { type: 'VARCHAR', sqlType: 'TIMESTAMP WITH TIME ZONE' };
    case 'time':
    case 'time without time zone':
      return { type: 'VARCHAR', sqlType: 'TIME' };
    case 'interval':
      return { type: 'VARCHAR', sqlType: 'INTERVAL' };
    case 'uuid':
      return { type: 'VARCHAR', sqlType: 'UUID' };
    case 'json':
    case 'jsonb':
      return { type: 'VARCHAR', sqlType: 'JSON' };
    case 'bytea':
      return { type: 'BLOB', sqlType: 'BLOB' };
    default:
      return TEXT;
  }
}

/** The type of a query's result field, from its type OID and typmod. */
export function pgFieldType(oid: number, typmod: number): PgType {
  const name = OID_NAMES[oid];
  if (!name) return TEXT;
  return pgType({ name, ...(name === 'numeric' ? numericTypmod(typmod) : {}) });
}

/** The type of a catalogued column from information_schema.columns: udt_name says the type, numeric_precision and numeric_scale its size. */
export function pgColumnType(column: { udt_name: string; data_type?: string; numeric_precision?: number | string | null; numeric_scale?: number | string | null }): PgType {
  const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? undefined : Number(v));
  // An array's udt_name starts with an underscore (_int4); information_schema says ARRAY. Both are text.
  if (column.data_type === 'ARRAY' || column.udt_name.startsWith('_')) return TEXT;
  return pgType({ name: column.udt_name, precision: num(column.numeric_precision), scale: num(column.numeric_scale) });
}

/** How the database writes a column's type for the schema (DBML): the SQL name with NUMERIC's size, as the DDL would. */
export function pgDeclaredType(column: { udt_name: string; data_type?: string; numeric_precision?: number | string | null; numeric_scale?: number | string | null; character_maximum_length?: number | string | null }): string {
  const u = column.udt_name;
  if (column.data_type === 'ARRAY' || u.startsWith('_')) return `${u.replace(/^_/, '')}[]`;
  const n = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? undefined : Number(v));
  if (u === 'numeric' && n(column.numeric_precision)) return `numeric(${n(column.numeric_precision)},${n(column.numeric_scale) ?? 0})`;
  if ((u === 'varchar' || u === 'bpchar') && n(column.character_maximum_length)) return `${u === 'bpchar' ? 'char' : 'varchar'}(${n(column.character_maximum_length)})`;
  if (column.data_type === 'USER-DEFINED') return u;
  return u;
}

const DATE_RE = /^(-?\d{4,})-(\d{2})-(\d{2})/;
const TIMESTAMP_RE = /^(\d{4,})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?/;

/** A date as text (ISO, YMD) to days since 1970-01-01; infinity, BC dates and anything else are null. */
export function dateDays(text: string): number | null {
  const m = DATE_RE.exec(text);
  if (!m || text.endsWith(' BC')) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/** A timestamp as text (ISO, no zone) to milliseconds since 1970-01-01 UTC; fractions beyond milliseconds are kept to the millisecond. */
export function timestampMs(text: string): number | null {
  const m = TIMESTAMP_RE.exec(text);
  if (!m || text.endsWith(' BC')) return null;
  const ms = m[7] ? Math.floor(Number((m[7] + '000000').slice(0, 6)) / 1000) : 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), ms);
}

/** bytea's hex text (\x0a0b) to bytes; the old escape format is kept as text. */
export function byteaBytes(text: string): Uint8Array | null {
  if (!text.startsWith('\\x')) return null;
  const hex = text.slice(2);
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** One value as the database wrote it (text, or null) for its column's Arrow type. */
export function convertValue(v: string | null | undefined, type: SheetColumnType): SheetColumn['values'][number] {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'BIGINT': {
      const n = Number(v);
      return Number.isSafeInteger(n) ? n : null;
    }
    case 'DOUBLE': {
      const n = Number(v);
      return Number.isNaN(n) && v !== 'NaN' ? null : n;
    }
    case 'BOOLEAN':
      return v === 't' || v === 'true' ? true : v === 'f' || v === 'false' ? false : null;
    case 'DATE':
      return dateDays(v);
    case 'TIMESTAMP':
      return timestampMs(v);
    case 'BLOB':
      return byteaBytes(v);
    default:
      return v;
  }
}
