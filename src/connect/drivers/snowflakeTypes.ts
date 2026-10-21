// Snowflake's types as Puddle loads them: the Arrow type the values cross in and the DuckDB type the table is
// created with, from a result's column metadata (the SQL API's rowType: a lower-case type with precision and scale)
// or an INFORMATION_SCHEMA.COLUMNS row. Pure, so the mapping is tested without an account. The SQL API writes every
// value as text in its own encodings: a FIXED or REAL as digits, a DATE as days since 1970, a TIME as seconds since
// midnight, a TIMESTAMP as "seconds.nanoseconds" (TIMESTAMP_TZ with the zone's offset after a space, in minutes
// from -1440), a BOOLEAN as true/false, BINARY as hex, and VARIANT, OBJECT and ARRAY as JSON text;
// `convertSnowflakeValue` turns those into what src/excel/arrow.ts expects.
import type { SheetColumn, SheetColumnType } from '../../excel/types';

export interface SnowflakeType {
  type: SheetColumnType;
  sqlType: string;
}

/** A result column as the SQL API's resultSetMetaData.rowType describes it. */
export interface SnowflakeField {
  name: string;
  type: string;
  precision?: number | null;
  scale?: number | null;
  nullable?: boolean;
  length?: number | null;
}

const TEXT: SnowflakeType = { type: 'VARCHAR', sqlType: 'VARCHAR' };
const JSON_TEXT: SnowflakeType = { type: 'VARCHAR', sqlType: 'JSON' };

/** NUMBER(p,s) as DuckDB holds it: whole numbers in BIGINT while they fit, otherwise a DECIMAL of the same size. */
export function numberType(precision: number | null | undefined, scale: number | null | undefined): SnowflakeType {
  const p = precision && precision > 0 && precision <= 38 ? precision : 38;
  const s = scale ?? 0;
  if (s === 0 && p <= 18) return { type: 'BIGINT', sqlType: 'BIGINT' };
  return { type: 'VARCHAR', sqlType: `DECIMAL(${p},${s})` };
}

/** The type of a type's name, as the result metadata (fixed, text, timestamp_ntz…) or INFORMATION_SCHEMA (NUMBER, TEXT, TIMESTAMP_NTZ…) spells it. */
export function snowflakeNamedType(name: string, precision?: number | null, scale?: number | null): SnowflakeType {
  const t = name.toUpperCase().replace(/\(.*$/s, '').trim();
  switch (t) {
    case 'FIXED':
    case 'NUMBER':
    case 'DECIMAL':
    case 'NUMERIC':
    case 'INT':
    case 'INTEGER':
    case 'BIGINT':
    case 'SMALLINT':
    case 'TINYINT':
    case 'BYTEINT':
      return numberType(precision, scale);
    case 'REAL':
    case 'FLOAT':
    case 'FLOAT4':
    case 'FLOAT8':
    case 'DOUBLE':
    case 'DOUBLE PRECISION':
      return { type: 'DOUBLE', sqlType: 'DOUBLE' };
    case 'BOOLEAN':
      return { type: 'BOOLEAN', sqlType: 'BOOLEAN' };
    case 'DATE':
      return { type: 'DATE', sqlType: 'DATE' };
    case 'TIME':
      return { type: 'VARCHAR', sqlType: 'TIME' };
    case 'TIMESTAMP':
    case 'TIMESTAMP_NTZ':
    case 'DATETIME':
    case 'TIMESTAMP_LTZ':
      return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP' };
    case 'TIMESTAMP_TZ':
      return { type: 'VARCHAR', sqlType: 'TIMESTAMP WITH TIME ZONE' };
    case 'BINARY':
    case 'VARBINARY':
      return { type: 'BLOB', sqlType: 'BLOB' };
    case 'VARIANT':
    case 'OBJECT':
    case 'ARRAY':
    case 'VECTOR':
      return JSON_TEXT;
    // TEXT, VARCHAR, CHAR, STRING, GEOGRAPHY, GEOMETRY and anything new are text.
    default:
      return TEXT;
  }
}

/** The type of a result column. */
export function snowflakeFieldType(f: SnowflakeField): SnowflakeType {
  return snowflakeNamedType(f.type, f.precision, f.scale);
}

/** A column as INFORMATION_SCHEMA.COLUMNS describes it. */
export interface SnowflakeColumnRow {
  DATA_TYPE: string;
  CHARACTER_MAXIMUM_LENGTH?: string | number | null;
  NUMERIC_PRECISION?: string | number | null;
  NUMERIC_SCALE?: string | number | null;
}

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));

/** The type of a catalogued column, and how its declaration reads (the DBML type). */
export function snowflakeColumnType(c: SnowflakeColumnRow): SnowflakeType & { declared: string } {
  const t = c.DATA_TYPE.toUpperCase();
  const precision = num(c.NUMERIC_PRECISION);
  const scale = num(c.NUMERIC_SCALE);
  const length = num(c.CHARACTER_MAXIMUM_LENGTH);
  const mapped = snowflakeNamedType(t, precision, scale);
  let declared = t;
  if (t === 'NUMBER' && precision !== null) declared = `NUMBER(${precision},${scale ?? 0})`;
  else if (t === 'TEXT') declared = length !== null ? `VARCHAR(${length})` : 'VARCHAR';
  return { ...mapped, declared };
}

const pad = (n: number, w = 2) => String(Math.trunc(n)).padStart(w, '0');

/** Seconds since midnight (with a fraction) as HH:MM:SS.fff text. */
export function timeText(seconds: number): string {
  const whole = Math.floor(seconds);
  const ms = Math.round((seconds - whole) * 1000);
  const base = `${pad(whole / 3600)}:${pad((whole % 3600) / 60)}:${pad(whole % 60)}`;
  return ms ? `${base}.${pad(ms, 3)}` : base;
}

/** "seconds.nanoseconds" since 1970 as milliseconds, rounded down to the millisecond. */
export function epochMs(text: string): number | null {
  const m = /^(-?\d+)(?:\.(\d+))?/.exec(text.trim());
  if (!m) return null;
  const ms = m[2] ? Math.floor(Number((m[2] + '000').slice(0, 3))) : 0;
  return Number(m[1]) * 1000 + (Number(m[1]) < 0 && ms ? -ms : ms);
}

/** A TIMESTAMP_TZ value ("seconds.nanos offset", the offset in minutes from -1440) as ISO text with its zone. */
export function timestampTzText(text: string): string | null {
  const [stamp, zone] = text.trim().split(/\s+/);
  const ms = epochMs(stamp ?? '');
  if (ms === null) return null;
  const offset = zone === undefined ? 0 : Number(zone) - 1440;
  const local = new Date(ms + offset * 60_000);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const frac = local.getUTCMilliseconds() ? `.${pad(local.getUTCMilliseconds(), 3)}` : '';
  return `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${frac}${sign}${pad(abs / 60)}:${pad(abs % 60)}`;
}

/** One value as the SQL API wrote it (text or null) for its column. */
export function convertSnowflakeValue(v: unknown, f: SnowflakeField): SheetColumn['values'][number] {
  if (v === null || v === undefined) return null;
  const text = String(v);
  const kind = f.type.toUpperCase();
  const { type } = snowflakeFieldType(f);
  if (kind === 'TIMESTAMP_TZ') return timestampTzText(text);
  switch (type) {
    case 'BIGINT': {
      const n = Number(text);
      return Number.isSafeInteger(n) ? n : null;
    }
    case 'DOUBLE': {
      const n = Number(text);
      return Number.isNaN(n) && text !== 'NaN' ? null : n;
    }
    case 'BOOLEAN':
      return text === 'true' || text === '1' ? true : text === 'false' || text === '0' ? false : null;
    case 'DATE': {
      const n = Number(text);
      return Number.isFinite(n) ? n : null;
    }
    case 'TIMESTAMP':
      return epochMs(text);
    case 'BLOB':
      return hexBytes(text);
    default:
      return kind === 'TIME' ? timeText(Number(text)) : text;
  }
}

function hexBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
