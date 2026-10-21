// BigQuery's types as Puddle loads them: the Arrow type the values cross in and the DuckDB type the table is created
// with, from a result's schema field (as the REST API gives it: name, type, mode, nested fields) or a column's
// declared type in INFORMATION_SCHEMA (`NUMERIC(10, 2)`, `ARRAY<STRING>`, `STRUCT<...>`). Pure, so the mapping is
// tested without a project. The REST API writes every value as text (a TIMESTAMP as seconds since 1970, BYTES as
// base64), a repeated field as `{v: [{v}, ...]}` and a record as `{v: {f: [{v}, ...]}}`; `plainValue` unwraps those
// and `convertBigqueryValue` turns the text into what src/excel/arrow.ts expects.
import type { SheetColumn, SheetColumnType } from '../../excel/types';
import { dateDays, timestampMs } from './pgTypes';

export interface BigqueryType {
  type: SheetColumnType;
  sqlType: string;
}

/** A field of a result's schema, as the REST API describes it. */
export interface BigqueryField {
  name: string;
  type: string;
  mode?: string;
  fields?: BigqueryField[];
}

const TEXT: BigqueryType = { type: 'VARCHAR', sqlType: 'VARCHAR' };
const JSON_TEXT: BigqueryType = { type: 'VARCHAR', sqlType: 'JSON' };

/** The type of a type's name without parameters, as the schema spells it (INT64 and INTEGER both occur). */
export function bigqueryNamedType(name: string): BigqueryType {
  switch (name.toUpperCase()) {
    case 'INTEGER':
    case 'INT64':
      return { type: 'BIGINT', sqlType: 'BIGINT' };
    case 'FLOAT':
    case 'FLOAT64':
      return { type: 'DOUBLE', sqlType: 'DOUBLE' };
    case 'NUMERIC':
    case 'DECIMAL':
      return { type: 'VARCHAR', sqlType: 'DECIMAL(38,9)' };
    case 'BOOLEAN':
    case 'BOOL':
      return { type: 'BOOLEAN', sqlType: 'BOOLEAN' };
    case 'BYTES':
      return { type: 'BLOB', sqlType: 'BLOB' };
    case 'DATE':
      return { type: 'DATE', sqlType: 'DATE' };
    case 'DATETIME':
    case 'TIMESTAMP':
      return { type: 'TIMESTAMP', sqlType: 'TIMESTAMP' };
    case 'TIME':
      return { type: 'VARCHAR', sqlType: 'TIME' };
    case 'INTERVAL':
      return { type: 'VARCHAR', sqlType: 'INTERVAL' };
    case 'JSON':
    case 'RECORD':
    case 'STRUCT':
      return JSON_TEXT;
    // STRING, GEOGRAPHY, RANGE, BIGNUMERIC (wider than DuckDB's decimals) and anything new are text.
    default:
      return TEXT;
  }
}

/** The type of a result field: a repeated field or a record is JSON text, whatever it holds. */
export function bigqueryFieldType(f: BigqueryField): BigqueryType {
  if (f.mode === 'REPEATED') return JSON_TEXT;
  return bigqueryNamedType(f.type);
}

/** The type of a column's declared type (INFORMATION_SCHEMA.COLUMNS data_type), which carries its parameters. */
export function bigqueryDeclaredType(declared: string): BigqueryType {
  const t = declared.trim();
  if (/^(ARRAY|STRUCT)\s*</i.test(t)) return JSON_TEXT;
  const m = /^(NUMERIC|DECIMAL|BIGNUMERIC|BIGDECIMAL)\s*\(\s*(\d+)(?:\s*,\s*(\d+))?\s*\)$/i.exec(t);
  if (m) {
    const precision = Number(m[2]);
    const scale = Number(m[3] ?? 0);
    return precision <= 38 ? { type: 'VARCHAR', sqlType: `DECIMAL(${precision},${scale})` } : TEXT;
  }
  return bigqueryNamedType(t.replace(/\(.*$/s, ''));
}

/** A cell as the REST API wraps it. */
export type Cell = { v: unknown };

/** A value unwrapped from the API's `{v}` cells: text or null, or an array or an object for a repeated field or a record. */
export function plainValue(v: unknown, f: BigqueryField): unknown {
  if (v === null || v === undefined) return null;
  if (f.mode === 'REPEATED') return Array.isArray(v) ? v.map((cell) => plainValue((cell as Cell).v, { ...f, mode: 'NULLABLE' })) : [];
  if ((f.type === 'RECORD' || f.type === 'STRUCT') && typeof v === 'object' && 'f' in (v as object)) {
    const cells = (v as { f: Cell[] }).f;
    return Object.fromEntries((f.fields ?? []).map((sub, i) => [sub.name, plainValue(cells[i]?.v, sub)]));
  }
  return v;
}

/** One unwrapped value for its field's Arrow type. */
export function convertBigqueryValue(v: unknown, f: BigqueryField): SheetColumn['values'][number] {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  const { type } = bigqueryFieldType(f);
  const text = String(v);
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
      return text === 'true' ? true : text === 'false' ? false : null;
    case 'DATE':
      return dateDays(text);
    case 'TIMESTAMP':
      // A TIMESTAMP is seconds since 1970 (possibly in exponent form); a DATETIME is wall-clock text with a T.
      return f.type.toUpperCase() === 'TIMESTAMP' ? Math.round(Number(text) * 1000) : timestampMs(text.replace('T', ' '));
    case 'BLOB':
      return base64ToBytes(text);
    default:
      return text;
  }
}

function base64ToBytes(text: string): Uint8Array {
  const s = atob(text.replace(/\s+/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
