import type { SourceFormat } from '../model';

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceError';
  }
}

const BY_EXTENSION: Record<string, SourceFormat> = {
  csv: 'csv',
  txt: 'csv',
  tsv: 'tsv',
  tab: 'tsv',
  json: 'json',
  ndjson: 'ndjson',
  jsonl: 'ndjson',
  parquet: 'parquet',
  pq: 'parquet',
  xlsx: 'xlsx',
  xml: 'xml',
};

export const ACCEPT = '.csv,.txt,.tsv,.tab,.json,.ndjson,.jsonl,.parquet,.pq,.xlsx,.xml';

const extensionOf = (name: string) => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

/** The format a file name's extension names, or undefined when Puddle doesn't know it. */
export const knownFormat = (name: string): SourceFormat | undefined => BY_EXTENSION[extensionOf(name)];

/** Pick the format from a file name, or say plainly why it can't be loaded. */
export function formatFromName(name: string): SourceFormat {
  const format = knownFormat(name);
  if (format) return format;
  const ext = extensionOf(name);
  if (ext === 'xls') throw new SourceError(`${name} is in the old Excel format (.xls), which Puddle doesn’t read. Open it in Excel and save it as .xlsx or CSV, then add that.`);
  throw new SourceError(`${name} isn't a format Puddle reads. Add a CSV, TSV, JSON, NDJSON, Parquet, Excel (.xlsx) or XML file.`);
}

/** Guess the format of pasted text: XML, JSON, NDJSON, tab-separated (spreadsheets paste as TSV) or CSV. */
export function formatFromText(text: string): SourceFormat {
  const t = text.trimStart();
  const firstLine = t.split(/\r?\n/, 1)[0] ?? '';
  if (/^<[?!a-zA-Z_]/.test(t)) return 'xml';
  if (t.startsWith('[')) return 'json';
  if (t.startsWith('{')) return /^\{.*\}\s*$/.test(firstLine) && t.includes('\n') ? 'ndjson' : 'json';
  if (firstLine.includes('\t')) return 'tsv';
  return 'csv';
}

/** A display name from a file name: "orders.csv" stays as it is. */
export const sourceName = (fileName: string) => fileName.trim() || 'Untitled source';
