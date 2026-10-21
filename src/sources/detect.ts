import { gzipEntryName } from '../archive';
import { SPREADSHEET_EXTENSIONS } from '../excel/formats';
import type { SourceFormat } from '../model';

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceError';
  }
}

const BY_EXTENSION: Record<string, SourceFormat> = {
  csv: 'csv',
  tsv: 'tsv',
  tab: 'tsv',
  json: 'json',
  ndjson: 'ndjson',
  jsonl: 'ndjson',
  parquet: 'parquet',
  pq: 'parquet',
  xml: 'xml',
  arrow: 'arrow',
  feather: 'arrow',
  ipc: 'arrow',
  mdb: 'access',
  accdb: 'access',
  // Every spreadsheet format SheetJS reads is the one source format 'xlsx' (src/excel/formats.ts).
  ...Object.fromEntries(SPREADSHEET_EXTENSIONS.map((ext) => [ext, 'xlsx' as const])),
};

export const ACCEPT = `.csv,.txt,.tsv,.tab,.json,.ndjson,.jsonl,.parquet,.pq,.arrow,.feather,.ipc,${SPREADSHEET_EXTENSIONS.map((e) => `.${e}`).join(',')},.xml,.mdb,.accdb,.gz,.zip,.dat,.log,.text,.prn`;

/** What Puddle reads, for the refusals. */
export const READS = 'Add a CSV, TSV, JSON, NDJSON, Parquet, Arrow, spreadsheet (.xlsx, .xls, .ods, .numbers, .dbf), XML or Access (.accdb, .mdb) file, or a .gz or .zip holding one.';

/** Plain-text extensions that say nothing about the shape inside; `sniff` reads it from the bytes. */
export const TEXT_EXTENSIONS = new Set(['txt', 'dat', 'log', 'text', 'prn']);

export const extensionOf = (name: string) => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

/** The format a file name's extension names (orders.csv.gz is a CSV), or undefined when Puddle doesn't know it. */
export const knownFormat = (name: string): SourceFormat | undefined => BY_EXTENSION[extensionOf(gzipEntryName(name))];

/** True for a name that says the file is compressed or an archive: it holds the file to read. */
export const isArchiveName = (name: string) => /\.(gz|gzip|zip)$/i.test(name);

/**
 * Pick the format from a file name alone (a file reconnected, or one at a web address), or say plainly why it can't
 * be loaded. A .txt file is taken as CSV here; with the bytes to hand, `sniff` reads what it really is.
 */
export function formatFromName(name: string): SourceFormat {
  const format = knownFormat(name);
  if (format) return format;
  const ext = extensionOf(name);
  if (TEXT_EXTENSIONS.has(ext)) return 'csv';
  throw new SourceError(`${name} isn't a format Puddle reads. ${READS}`);
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
