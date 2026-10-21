// Reading fixed-width text, pipe tables and structured text (YAML, TOML, INI, GeoJSON) into the CSV DuckDB reads,
// shared by the browser (./rewrite) and the runner (src/runner/run.ts). Pure: bytes and options in, CSV out.
import type { ParseOptions, Source } from '../model';
import { isStructuredFormat, parseStructured, structuredToTable, type RecordCandidate, type StructuredFormat } from '../structured';
import { tableToCsv } from '../xml';
import { readFixedWidth } from './fixedWidth';
import { readPipes } from './pipes';

export type RewrittenFormat = 'fixed' | 'pipes' | StructuredFormat;

export const isRewrittenText = (s: Pick<Source, 'format'>): s is Source & { format: RewrittenFormat } => s.format === 'fixed' || s.format === 'pipes' || isStructuredFormat(s.format);

/** Decode a file's bytes in the encoding its read options name (as the sniff set it): UTF-16 by its BOM, Latin-1 as Windows-1252, else UTF-8. */
export function decodeText(bytes: Uint8Array, encoding?: string): string {
  if (encoding === 'utf-16') {
    const be = bytes[0] === 0xfe && bytes[1] === 0xff;
    return new TextDecoder(be ? 'utf-16be' : 'utf-16le').decode(bytes).replace(/^\uFEFF/, '');
  }
  if (encoding === 'latin-1') return new TextDecoder('windows-1252').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

export interface RewrittenTable {
  columns: string[];
  rows: string[][];
  /** Fixed width: the boundaries used (found from the text when the options had none). */
  boundaries?: number[];
  /** Pipe table: lines around the table that were dropped. */
  dropped?: number;
  /** Structured text: the records read, as a path of keys, and every place records were found. */
  record?: string;
  candidates?: RecordCandidate[];
}

/** Read the text as the format says, with its read options. */
export function readText(format: RewrittenFormat, text: string, o: ParseOptions): RewrittenTable {
  if (isStructuredFormat(format)) {
    const t = structuredToTable(parseStructured(format, text), format, { record: o.record });
    return { columns: t.columns, rows: t.rows, record: t.record, candidates: t.candidates };
  }
  if (format === 'fixed') {
    const t = readFixedWidth(text, { boundaries: o.boundaries, header: o.header, skip: o.skip, skipBottom: o.skipBottom });
    return { columns: t.columns, rows: t.rows, boundaries: t.boundaries };
  }
  const t = readPipes(text, { header: o.header });
  return { columns: t.columns, rows: t.rows, dropped: t.dropped };
}

/** The CSV DuckDB reads for the table: a header row, commas and double quotes. */
export const rewrittenCsv = (table: RewrittenTable) => tableToCsv(table);

/** How many lines of the text the inspector's ruler shows. */
export const RULER_LINES = 12;

/** The first lines of the table, for the ruler: the skipped lines and blank ones left out, as the reader leaves them. */
export function rulerLines(text: string, skip = 0): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .slice(skip)
    .filter((l) => l.trim().length > 0)
    .slice(0, RULER_LINES);
}
