// A schema inferred from documents, for stores with no column catalogue (MongoDB, DynamoDB, Redis, SurrealDB): the
// fields seen across a sample, the types each held and how often it was present, as a table the catalogue-to-schema
// conversion documents like any other, with a note saying it was inferred and from how many documents.
import type { DocColumn, DocTable } from '../connect/types';

/** The kinds a value is counted as. */
export type SeenType = 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'object' | 'array' | 'binary' | 'null';

export interface InferredField {
  name: string;
  /** How many documents hold the field (null counts as held). */
  present: number;
  /** Each type seen, with the count of documents holding it. */
  types: Partial<Record<SeenType, number>>;
}

export interface InferredSchema {
  documents: number;
  fields: InferredField[];
}

export const SAMPLE_SIZE = 1000;

const seenType = (v: unknown): SeenType => {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Date) return 'date';
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) return 'binary';
  switch (typeof v) {
    case 'string':
      return 'string';
    case 'number':
      return Number.isInteger(v) ? 'integer' : 'number';
    case 'bigint':
      return 'integer';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
};

/** The fields of a sample of documents (at most SAMPLE_SIZE), nested objects flattened to `parent.child` to `depth`; a parent that was opened is not a field itself. */
export function inferFields(documents: unknown[], depth = 2): InferredSchema {
  const sample = documents.slice(0, SAMPLE_SIZE);
  const fields = new Map<string, InferredField>();
  const see = (name: string, v: unknown, level: number) => {
    const t = seenType(v);
    // A nested object within the depth is opened into its children and is no field itself (an empty one is kept, so it is seen at all).
    if (t === 'object' && level < depth && Object.keys(v as object).length) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) see(`${name}.${k}`, x, level + 1);
      return;
    }
    const f = fields.get(name) ?? { name, present: 0, types: {} };
    fields.set(name, f);
    f.present++;
    f.types[t] = (f.types[t] ?? 0) + 1;
  };
  for (const d of sample) {
    if (d && typeof d === 'object' && !Array.isArray(d)) for (const [k, v] of Object.entries(d as Record<string, unknown>)) see(k, v, 1);
  }
  return { documents: sample.length, fields: [...fields.values()] };
}

/** The type a field is documented as: the one type seen (null aside), or the types joined when it held several. */
export function inferredType(f: InferredField): string {
  const seen = (Object.keys(f.types) as SeenType[]).filter((t) => t !== 'null').sort((a, b) => (f.types[b] ?? 0) - (f.types[a] ?? 0));
  if (!seen.length) return 'null';
  if (seen.length === 1) return seen[0]!;
  return seen.join(' or ');
}

const percent = (n: number, of: number) => `${Math.round((n / Math.max(1, of)) * 100)}%`;

/** The sample as a table to document: a column per field, not null when every document holds a value, a note on how often each was present. */
export function inferTable(name: string, documents: unknown[], at: Date, options: { schema?: string; depth?: number; keys?: string[] } = {}): DocTable {
  const inferred = inferFields(documents, options.depth);
  const keys = options.keys ?? ['_id', 'id'];
  const columns: DocColumn[] = inferred.fields.map((f) => {
    const nulls = f.types.null ?? 0;
    const always = f.present === inferred.documents && nulls === 0;
    const pk = keys.includes(f.name) && always;
    const detail = [f.present < inferred.documents && `present in ${percent(f.present, inferred.documents)} of documents`, nulls > 0 && `null in ${percent(nulls, inferred.documents)}`].filter(Boolean).join(', ');
    return { name: f.name, type: inferredType(f), pk, unique: pk, notNull: always, increment: false, ...(detail ? { note: detail } : {}) };
  });
  return { ...(options.schema ? { schema: options.schema } : {}), name, kind: 'table', columns, indexes: [], foreignKeys: [], note: `Inferred from ${inferred.documents.toLocaleString('en-GB')} ${inferred.documents === 1 ? 'document' : 'documents'} on ${at.toISOString().slice(0, 10)}` };
}
