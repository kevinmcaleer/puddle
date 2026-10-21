// Structured text (YAML, TOML, INI, GeoJSON) read into rows the same way: the text is parsed into a value, the
// records in it are found (an array of objects, or the entries of a map), and each record becomes a row with its
// nested fields flattened into dotted columns and anything that repeats kept as JSON. Pure, so it is tested on text
// and shared by the browser (src/sources/rewrite.ts) and the runner.
import { load as loadYaml } from 'js-yaml';
import { parse as parseToml, TomlDate } from 'smol-toml';
import { parseIni } from './ini';

export type StructuredFormat = 'yaml' | 'toml' | 'ini' | 'geojson';

export const STRUCTURED_FORMATS: StructuredFormat[] = ['yaml', 'toml', 'ini', 'geojson'];

export const isStructuredFormat = (format: string): format is StructuredFormat => (STRUCTURED_FORMATS as string[]).includes(format);

export class StructuredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StructuredError';
  }
}

type Value = unknown;
type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof TomlDate);

/** Parse the text as the format says, into a plain value. */
export function parseStructured(format: StructuredFormat, text: string): Value {
  const clean = text.replace(/^\uFEFF/, '');
  try {
    switch (format) {
      case 'yaml': {
        // A file of several documents (--- between them) reads as a list of them.
        const docs: unknown[] = [];
        for (const doc of splitYamlDocuments(clean)) docs.push(loadYaml(doc));
        return docs.length === 1 ? docs[0] : docs;
      }
      case 'toml':
        return parseToml(clean);
      case 'ini':
        return parseIni(clean);
      case 'geojson':
        return JSON.parse(clean);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message.split('\n')[0] : String(e);
    throw new StructuredError(`This isn’t ${FORMAT_NAMES[format]} Puddle can read (${message}). Check the file, or choose another format.`);
  }
}

const FORMAT_NAMES: Record<StructuredFormat, string> = { yaml: 'YAML', toml: 'TOML', ini: 'an INI file', geojson: 'GeoJSON' };

/** YAML documents, split on a --- line; a leading --- is not a split. */
function splitYamlDocuments(text: string): string[] {
  const parts = text.split(/^---[ \t]*(?:\r?\n|$)/m);
  const docs = parts.filter((p, i) => i > 0 || p.trim().length > 0);
  return docs.length ? docs : [''];
}

/** Where records are in the value: a path of keys, how many there are, and whether they are a list or a map's entries. */
export interface RecordCandidate {
  /** Keys from the root joined by /; '' is the root itself, and '.' the whole document as one row. */
  path: string;
  count: number;
  /** 'list' is an array of records; 'map' is an object whose entries become rows, named by a `key` column; 'one' is the object itself as a single row. */
  kind: 'list' | 'map' | 'one';
}

/** The record path meaning the whole document as one row. */
export const ONE = '.';

const isRecordList = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0 && v.every((x) => isObject(x));
/** A record of plain fields: no maps inside (lists are kept as JSON). */
const isFlat = (v: Obj) => Object.values(v).every((x) => !isObject(x));
/** A map of records (INI sections, TOML tables): at least two entries that are flat records; scalar entries beside them are left out. */
const isRecordMap = (v: unknown): v is Obj => isObject(v) && mapRecords(v).length >= 2 && mapRecords(v).every(([, x]) => isFlat(x));
const mapRecords = (v: Obj): [string, Obj][] => Object.entries(v).filter((e): e is [string, Obj] => isObject(e[1]));

/** The places in the value that could be read as rows, likeliest first: the biggest list of records, the shallowest, then maps of records, then the whole document as one row. */
export function recordCandidates(value: Value): RecordCandidate[] {
  const found: RecordCandidate[] = [];
  // One GeoJSON feature is one row, whatever its properties and geometry look like.
  if (isObject(value) && value.type === 'Feature') return [{ path: ONE, count: 1, kind: 'one' }];
  const walk = (v: unknown, path: string, depth: number) => {
    if (depth > 6) return;
    if (isRecordList(v)) found.push({ path, count: v.length, kind: 'list' });
    else if (isRecordMap(v)) found.push({ path, count: mapRecords(v).length, kind: 'map' });
    if (Array.isArray(v)) {
      // A list of lists or scalars isn't records, but records may be deeper inside one list of objects.
      if (isRecordList(v)) for (const [k, x] of Object.entries(v[0] as Obj)) walk(x, path ? `${path}/${k}` : k, depth + 1);
    } else if (isObject(v)) for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}/${k}` : k, depth + 1);
  };
  walk(value, '', 0);
  const depthOf = (p: string) => (p ? p.split('/').length : 0);
  found.sort((a, b) => Number(a.kind === 'map') - Number(b.kind === 'map') || b.count - a.count || depthOf(a.path) - depthOf(b.path));
  if (isObject(value)) found.push({ path: ONE, count: 1, kind: 'one' });
  if (!found.length) found.push({ path: '', count: Array.isArray(value) ? value.length : 1, kind: 'list' });
  return found;
}

/** A scalar as text: dates as ISO 8601, null as empty. */
function scalar(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  if (v instanceof TomlDate) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  return String(v);
}

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x instanceof TomlDate ? x.toISOString() : x));

/** One record flattened: nested objects into "a.b" columns, lists kept as JSON. */
function flatten(v: unknown, prefix: string, out: Map<string, string>) {
  if (isObject(v)) {
    const entries = Object.entries(v);
    if (!entries.length && prefix) out.set(prefix, '{}');
    for (const [k, x] of entries) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(v)) out.set(prefix || 'value', json(v));
  else out.set(prefix || 'value', scalar(v));
}

export interface StructuredTable {
  columns: string[];
  rows: string[][];
  /** The records read, as a path from the root. */
  record: string;
  candidates: RecordCandidate[];
}

/** The value at a path of keys. */
function at(value: unknown, path: string): unknown {
  let v = value;
  for (const key of path && path !== ONE ? path.split('/') : []) {
    if (Array.isArray(v)) v = v[0];
    if (!isObject(v)) return undefined;
    v = v[key];
  }
  return v;
}

/** The rows of the records at `record` (the likeliest when not given). A GeoJSON feature is its properties, its id and its geometry as JSON. */
export function structuredToTable(value: Value, format: StructuredFormat, options: { record?: string } = {}): StructuredTable {
  const candidates = recordCandidates(value);
  const chosen = options.record != null && candidates.some((c) => c.path === options.record) ? candidates.find((c) => c.path === options.record)! : candidates[0]!;
  const target = at(value, chosen.path);
  const records: { key?: string; value: unknown }[] =
    chosen.kind === 'map' ? mapRecords(target as Obj).map(([key, value]) => ({ key, value })) : chosen.kind === 'one' ? [{ value: target }] : (Array.isArray(target) ? target : [target]).map((value) => ({ value }));
  const columns: string[] = [];
  const index = new Map<string, number>();
  const col = (name: string) => {
    let i = index.get(name);
    if (i === undefined) {
      i = columns.length;
      index.set(name, i);
      columns.push(name);
    }
    return i;
  };
  if (chosen.kind === 'map') col('key');
  const rows: string[][] = [];
  for (const r of records) {
    const flat = new Map<string, string>();
    if (r.key !== undefined) flat.set('key', r.key);
    if (format === 'geojson' && isObject(r.value) && r.value.type === 'Feature') {
      if (r.value.id != null) flat.set('id', scalar(r.value.id));
      flatten(r.value.properties ?? {}, '', flat);
      flat.set('geometry', r.value.geometry == null ? '' : json(r.value.geometry));
    } else flatten(r.value, '', flat);
    const row: string[] = [];
    for (const [name, v] of flat) row[col(name)] = v;
    rows.push(row);
  }
  for (const row of rows) for (let i = 0; i < columns.length; i++) row[i] ??= '';
  return { columns, rows, record: chosen.path, candidates };
}

/** "features (12 records)" for the Records select. */
export const candidateLabel = (c: RecordCandidate) =>
  c.kind === 'one' ? 'The whole document, as one row' : `${c.path ? c.path.split('/').join(' › ') : 'The list at the top'} (${c.count.toLocaleString('en-GB')} ${c.kind === 'map' ? (c.count === 1 ? 'entry' : 'entries') : c.count === 1 ? 'record' : 'records'})`;
