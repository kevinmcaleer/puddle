// Documents as rows, for the stores that keep records rather than tables (SurrealDB, DynamoDB, and MongoDB after
// them; plan section 5.1): each document's nested objects are flattened to `parent.child` columns to a depth, deeper
// objects and arrays become JSON text, and every column's type is the one its values agree on (integers, doubles,
// booleans, dates, text, bytes), text where they don't. The same flattening names the columns the schema is
// documented with (src/schema/inferSchema.ts), so a documented table and a read agree.
import type { SheetColumn, SheetColumnType } from '../excel/types';

export const DEFAULT_DEPTH = 2;

type Plain = Record<string, unknown>;

const isPlain = (v: unknown): v is Plain => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Uint8Array) && !(v instanceof ArrayBuffer);

/** One document as a flat record: nested objects opened to `depth`, the rest left as values (an empty object stays one). */
export function flattenDocument(doc: unknown, depth = DEFAULT_DEPTH): Plain {
  const out: Plain = {};
  const walk = (prefix: string, v: unknown, level: number) => {
    if (isPlain(v) && level < depth && Object.keys(v).length) {
      for (const [k, x] of Object.entries(v)) walk(prefix ? `${prefix}.${k}` : k, x, level + 1);
    } else out[prefix] = v;
  };
  if (isPlain(doc)) for (const [k, v] of Object.entries(doc)) walk(k, v, 1);
  return out;
}

type Kind = 'BIGINT' | 'DOUBLE' | 'BOOLEAN' | 'TIMESTAMP' | 'VARCHAR' | 'BLOB' | 'JSON';

const kindOf = (v: unknown): Kind | undefined => {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return 'TIMESTAMP';
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) return 'BLOB';
  switch (typeof v) {
    case 'string':
      return 'VARCHAR';
    case 'number':
      return Number.isInteger(v) && Number.isSafeInteger(v) ? 'BIGINT' : 'DOUBLE';
    case 'bigint':
      return 'BIGINT';
    case 'boolean':
      return 'BOOLEAN';
    default:
      return 'JSON';
  }
};

/** The type a column's values agree on: integers widen to doubles, anything else mixed is text. */
export function columnKind(values: unknown[]): Kind {
  let kind: Kind | undefined;
  for (const v of values) {
    const k = kindOf(v);
    if (!k) continue;
    if (!kind) kind = k;
    else if (kind !== k) {
      if ((kind === 'BIGINT' && k === 'DOUBLE') || (kind === 'DOUBLE' && k === 'BIGINT')) kind = 'DOUBLE';
      else return 'VARCHAR';
    }
  }
  return kind ?? 'VARCHAR';
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? `0x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}` : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** One value as its column's Arrow type takes it. */
export function documentValue(v: unknown, kind: Kind): SheetColumn['values'][number] {
  if (v === null || v === undefined) return null;
  switch (kind) {
    case 'BIGINT':
    case 'DOUBLE':
      return typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null;
    case 'BOOLEAN':
      return typeof v === 'boolean' ? v : null;
    case 'TIMESTAMP':
      return v instanceof Date ? v.getTime() : null;
    case 'BLOB':
      return v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null;
    case 'JSON':
      return JSON.stringify(v);
    default:
      return text(v);
  }
}

/** The DuckDB type a kind loads as, and the Arrow type it crosses as (JSON crosses as text). */
const sheetType = (kind: Kind): { type: SheetColumnType; sqlType: string } => (kind === 'JSON' ? { type: 'VARCHAR', sqlType: 'JSON' } : { type: kind, sqlType: kind });

/**
 * Documents as sheet columns: one per field seen across them, in the order first seen, each typed from its values.
 * A document missing a field has null there.
 */
export function documentsToSheet(documents: unknown[], depth = DEFAULT_DEPTH): { columns: SheetColumn[]; sqlTypes: string[] } {
  const flat = documents.map((d) => flattenDocument(d, depth));
  const names: string[] = [];
  const seen = new Set<string>();
  for (const f of flat) {
    for (const k of Object.keys(f)) {
      if (!seen.has(k)) {
        seen.add(k);
        names.push(k);
      }
    }
  }
  const columns: SheetColumn[] = [];
  const sqlTypes: string[] = [];
  for (const name of names) {
    const values = flat.map((f) => f[name]);
    const kind = columnKind(values);
    const { type, sqlType } = sheetType(kind);
    columns.push({ name, type, values: values.map((v) => documentValue(v, kind)) });
    sqlTypes.push(sqlType);
  }
  return { columns, sqlTypes };
}
