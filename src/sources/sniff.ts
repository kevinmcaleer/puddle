// What a file is, from its bytes: the signature for binary formats, the encoding and the shape of the text for the
// rest. Content wins over the file name when it is unambiguous (plan D24); when it isn't, the result says so and the
// Format picker asks. Pure, so it is tested on bytes.
import type { ParseOptions, SourceFormat } from '../model';
import { knownFormat, SourceError } from './detect';
import { detectBoundaries } from './fixedWidth';

export type Confidence = 'sure' | 'likely' | 'unsure';

/** A format the sniff can name but Puddle doesn't read, so the refusal can say what the file is. */
export type OtherFormat = 'xls' | 'xlsb' | 'ods' | 'word' | 'powerpoint' | 'zip' | 'gzip' | 'bzip2' | 'zstd' | 'arrow' | 'sqlite' | 'pdf' | 'ole' | 'binary';

export interface Sniffed {
  format: SourceFormat;
  confidence: Confidence;
  /** The read options the content asks for: delimiter when not a comma, encoding when not UTF-8, header when the first row is data. */
  parseOptions: ParseOptions;
  /** The other readable formats the content could be; two that fit keep the confidence below sure. */
  alternatives: SourceFormat[];
  /** What was seen, in plain words, for the Format picker and the tests. */
  reason: string;
}

export interface SniffInput {
  name: string;
  /** The first megabyte (or the whole file when smaller). */
  head: Uint8Array;
  size?: number;
  /** The last few lines' worth of the file, when the head doesn't reach the end: for the footer. */
  tail?: Uint8Array;
}

const ascii = (bytes: Uint8Array, at: number, text: string) => bytes.length >= at + text.length && text.split('').every((ch, i) => bytes[at + i] === ch.charCodeAt(0));
const startsWith = (bytes: Uint8Array, ...sig: number[]) => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);

/** Entry names in a zip's local file headers, for telling an Excel workbook from a document from an archive. */
function zipEntries(bytes: Uint8Array): string[] {
  const names: string[] = [];
  let at = 0;
  while (at + 30 <= bytes.length && startsWith(bytes.subarray(at), 0x50, 0x4b, 0x03, 0x04) && names.length < 64) {
    const compressed = bytes[at + 18]! | (bytes[at + 19]! << 8) | (bytes[at + 20]! << 16) | (bytes[at + 21]! << 24);
    const nameLength = bytes[at + 26]! | (bytes[at + 27]! << 8);
    const extraLength = bytes[at + 28]! | (bytes[at + 29]! << 8);
    names.push(new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength)));
    // A data descriptor (bit 3) means the size isn't known here; stop at the first such entry.
    if (bytes[at + 6]! & 0x08) break;
    at += 30 + nameLength + extraLength + (compressed >>> 0);
  }
  return names;
}

/** The format a binary signature names: one Puddle reads, or one it can name in the refusal. */
export function signatureOf(head: Uint8Array): SourceFormat | OtherFormat | undefined {
  if (startsWith(head, 0x50, 0x4b, 0x03, 0x04)) {
    const entries = zipEntries(head);
    if (entries.some((e) => e.startsWith('xl/'))) return entries.some((e) => /^xl\/worksheets\/sheet\d+\.bin$/.test(e)) || entries.includes('xl/workbook.bin') ? 'xlsb' : 'xlsx';
    if (entries.includes('mimetype') || entries.includes('content.xml')) return 'ods';
    if (entries.some((e) => e.startsWith('word/'))) return 'word';
    if (entries.some((e) => e.startsWith('ppt/'))) return 'powerpoint';
    return 'zip';
  }
  if (startsWith(head, 0xd0, 0xcf, 0x11, 0xe0)) return 'ole';
  if (ascii(head, 0, 'PAR1')) return 'parquet';
  if (ascii(head, 0, 'ARROW1')) return 'arrow';
  if (ascii(head, 0, 'SQLite format 3\0')) return 'sqlite';
  if (startsWith(head, 0x00, 0x01, 0x00, 0x00) && (ascii(head, 4, 'Standard Jet DB') || ascii(head, 4, 'Standard ACE DB'))) return 'access';
  if (startsWith(head, 0x1f, 0x8b)) return 'gzip';
  if (ascii(head, 0, 'BZh')) return 'bzip2';
  if (startsWith(head, 0x28, 0xb5, 0x2f, 0xfd)) return 'zstd';
  if (ascii(head, 0, '%PDF')) return 'pdf';
  return undefined;
}

const OTHER_NAMES: Record<OtherFormat, string> = {
  xls: 'the old Excel format (.xls)',
  xlsb: 'an Excel binary workbook (.xlsb)',
  ods: 'an OpenDocument spreadsheet (.ods)',
  word: 'a Word document',
  powerpoint: 'a PowerPoint presentation',
  zip: 'a zip archive',
  gzip: 'a gzip-compressed file',
  bzip2: 'a bzip2-compressed file',
  zstd: 'a zstd-compressed file',
  arrow: 'an Arrow file',
  sqlite: 'a SQLite database',
  pdf: 'a PDF',
  ole: 'an old Office file (.xls or .doc)',
  binary: 'a binary file',
};

const READS = 'Add a CSV, TSV, JSON, NDJSON, Parquet, Excel (.xlsx), XML or Access (.accdb, .mdb) file.';

/** The refusal for a format Puddle can name but not read, as the brand book words it: what it is, then what to do. */
export function refusal(name: string, other: OtherFormat): SourceError {
  if (other === 'xls' || other === 'ole') return new SourceError(`${name} is in the old Excel format (.xls), which Puddle doesn’t read. Open it in Excel and save it as .xlsx or CSV, then add that.`);
  if (other === 'xlsb' || other === 'ods') return new SourceError(`${name} is ${OTHER_NAMES[other]}, which Puddle doesn’t read yet. Save it as .xlsx or CSV, then add that.`);
  if (other === 'gzip' || other === 'bzip2' || other === 'zstd' || other === 'zip') return new SourceError(`${name} is ${OTHER_NAMES[other]}, which Puddle doesn’t open yet. Unpack it and add the file inside.`);
  return new SourceError(`${name} is ${OTHER_NAMES[other]}, which Puddle doesn’t read. ${READS}`);
}

export interface Decoded {
  text: string;
  /** The read option for DuckDB; undefined for UTF-8. */
  encoding?: 'utf-16' | 'latin-1';
  bom: boolean;
}

/** Decode the head as text: by its BOM, as UTF-8 when it is valid, else as Windows-1252 (read by DuckDB as latin-1). */
export function decodeHead(head: Uint8Array, whole = true): Decoded | { binary: true } {
  if (startsWith(head, 0xef, 0xbb, 0xbf)) return { text: new TextDecoder('utf-8').decode(head.subarray(3)), bom: true };
  if (startsWith(head, 0xff, 0xfe) || startsWith(head, 0xfe, 0xff)) {
    const le = head[0] === 0xff;
    return { text: new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(head.subarray(2)), encoding: 'utf-16', bom: true };
  }
  // UTF-16 without a BOM: every other byte is a NUL in Latin text.
  let evenNul = 0;
  let oddNul = 0;
  const probe = Math.min(head.length, 4096);
  for (let i = 0; i < probe; i++) {
    if (head[i] !== 0) continue;
    if (i % 2) oddNul++;
    else evenNul++;
  }
  if (probe >= 8 && (oddNul > probe / 3 || evenNul > probe / 3) && Math.abs(oddNul - evenNul) > probe / 4) {
    return { text: new TextDecoder(oddNul > evenNul ? 'utf-16le' : 'utf-16be').decode(head), encoding: 'utf-16', bom: false };
  }
  if (evenNul + oddNul > 0) return { binary: true };
  // Control bytes other than tab, newline, carriage return and form feed don't belong in text.
  let controls = 0;
  for (let i = 0; i < probe; i++) {
    const b = head[i]!;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0b && b !== 0x0c && b !== 0x0d) controls++;
    else if (b === 0x7f) controls++;
  }
  if (probe > 0 && controls / probe >= 0.05) return { binary: true };
  // A head cut mid-character at the megabyte would fail the strict decode: leave the last few bytes out of the check.
  const checked = whole ? head : head.subarray(0, Math.max(0, head.length - 3));
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(checked);
    return { text: new TextDecoder('utf-8').decode(head), bom: false };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(head), encoding: 'latin-1', bom: false };
  }
}

const CANDIDATES = [',', '\t', ';', '|'] as const;
const LINES = 200;

/** How many of `delimiter` a line has outside double quotes. */
export function countOutsideQuotes(line: string, delimiter: string): number {
  let n = 0;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === delimiter) n++;
  }
  return n;
}

export interface Delimited {
  delimiter: string;
  /** The share of lines with the delimiter's usual count. */
  share: number;
  /** Fields per line, at the usual count. */
  fields: number;
}

/** The delimiter whose count is the same on most lines, with the most lines agreeing (then the most fields) first. */
export function sniffDelimiter(lines: string[]): Delimited | undefined {
  let best: Delimited | undefined;
  for (const delimiter of CANDIDATES) {
    const counts = lines.map((l) => countOutsideQuotes(l, delimiter));
    const tally = new Map<number, number>();
    for (const c of counts) if (c > 0) tally.set(c, (tally.get(c) ?? 0) + 1);
    let mode = 0;
    let at = 0;
    for (const [c, n] of tally) if (n > at || (n === at && c > mode)) [mode, at] = [c, n];
    if (!at) continue;
    const share = at / lines.length;
    if (share < 0.6) continue;
    if (!best || share > best.share + 0.05 || (Math.abs(share - best.share) <= 0.05 && mode + 1 > best.fields)) best = { delimiter, share, fields: mode + 1 };
  }
  return best;
}

const NUMBER = /^[-+(]?\s*[£$€]?\s*\d[\d,.\s]*%?\)?$/;
const looksNumeric = (v: string) => NUMBER.test(v.trim()) && /\d/.test(v);

/** Split a line on the delimiter, honouring double quotes (enough for sniffing, not a full CSV parse). */
export function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === delimiter) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Whether the first row is a header: false when a column is numbers in the rows below and the first row's value
 * there is a number too; undefined (left to DuckDB) when nothing says either way.
 */
export function sniffHeader(lines: string[], delimiter: string): false | undefined {
  const rows = lines.map((l) => splitLine(l, delimiter));
  const first = rows[0];
  if (!first || rows.length < 3) return undefined;
  for (let c = 0; c < first.length; c++) {
    const below = rows.slice(1).map((r) => r[c]?.trim() ?? '').filter(Boolean);
    if (below.length < 2) continue;
    const numeric = below.filter(looksNumeric).length / below.length;
    if (numeric >= 0.8 && looksNumeric(first[c]!)) return false;
  }
  return undefined;
}


/** What surrounds the table in a text file: lines to skip at the top and bottom. */
export interface Shape {
  skip: number;
  skipBottom: number;
  /** In plain words, for the reason. */
  notes: string[];
}

const COMMENT_PREFIXES = ['#', '//', ';;', '--', "'"];

/**
 * The lines around a delimited table, from the raw head lines (blank ones included) and the tail: a banner of lines
 * narrower than the table above the header, comment lines among them (DuckDB's `comment` option keeps the header
 * as a row, so they are skipped by count instead); a footer of narrower lines at the end.
 */
export function sniffShape(headLines: string[], tailLines: string[] | undefined, delimiter: string, fields: number): Shape {
  const width = (l: string) => countOutsideQuotes(l, delimiter) + 1;
  // A line as wide as the table, or wider: a ragged row (a header ending in a comma, an unquoted comma in a value) is
  // still a row of the table, where a banner or footer line is narrower.
  const full = (l: string) => l.trim().length > 0 && width(l) >= fields;
  const notes: string[] = [];
  // A comment prefix: lines starting with it, none of them as wide as the table, among the first lines.
  const first = headLines.slice(0, 50);
  let comment: string | undefined;
  for (const prefix of COMMENT_PREFIXES) {
    const marked = first.filter((l) => l.startsWith(prefix));
    if (marked.length && marked.every((l) => !full(l)) && (prefix !== '--' || !first.some(full) || !first.some((l) => l.startsWith('---') && /^-+$/.test(l.trim())))) {
      comment = prefix;
      break;
    }
  }
  const isComment = (l: string) => comment != null && l.startsWith(comment);
  // The banner: everything before the first line as wide as the table.
  let headerAt = headLines.findIndex((l) => full(l) && !isComment(l));
  if (headerAt < 0) headerAt = 0;
  const skip = headerAt;
  if (skip) {
    const comments = headLines.slice(0, headerAt).filter(isComment).length;
    notes.push(`${skip} ${skip === 1 ? 'line' : 'lines'} above the header${comments ? ` (${comments} starting with ${comment})` : ''}`);
  }
  // The footer: trailing lines narrower than the table, blank ones aside (DuckDB never reads those as rows).
  let skipBottom = 0;
  if (tailLines) {
    const rows = tailLines.filter((l) => l.trim().length > 0);
    let i = rows.length - 1;
    while (i >= 0 && !full(rows[i]!)) i--;
    skipBottom = i >= 0 ? rows.length - 1 - i : 0;
    if (skipBottom) notes.push(`${skipBottom} ${skipBottom === 1 ? 'line' : 'lines'} after the table`);
  }
  return { skip, skipBottom, notes };
}

/**
 * Column names from a header line, as DuckDB would name them: trimmed, an empty one `column<i>`, a repeat suffixed
 * `_1`, `_2`. With no header, every column is `column<i>`.
 */
export function columnNames(headerLine: string | undefined, delimiter: string, fields: number): string[] {
  const cells = headerLine == null ? [] : splitLine(headerLine, delimiter).map((c) => c.trim());
  const seen = new Map<string, number>();
  return Array.from({ length: Math.max(fields, cells.length) }, (_, i) => {
    const base = cells[i] || `column${i}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}_${n}` : base;
  });
}

const rawLines = (text: string) => text.split(/\r\n|\r|\n/);

const nonEmptyLines = (text: string) => text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);


/**
 * The read options a shape asks for: only what is there. A skipped banner also names the columns from the header
 * line, since DuckDB's own detection fails below a skip when a row is ragged (every column is then read as text).
 */
function shapeOptions(shape: Shape, headLines: string[], delimiter: string, fields: number, header: boolean | undefined): ParseOptions {
  const out: ParseOptions = {};
  if (shape.skip) {
    out.skip = shape.skip;
    out.columns = columnNames(header === false ? undefined : headLines[shape.skip], delimiter, fields);
  }
  if (shape.skipBottom) out.skipBottom = shape.skipBottom;
  return out;
}

const withNotes = (reason: string, shape: Shape) => (shape.notes.length ? `${reason} Skipped: ${shape.notes.join(', ')}.` : reason);

/** What a text looks like, before the file name has its say. */
export function sniffText(text: string, tail?: string): Sniffed {
  const t = text.replace(/^\uFEFF/, '').trimStart();
  const raw = rawLines(text.replace(/^\uFEFF/, ''));
  const tailRaw = tail != null ? rawLines(tail) : undefined;
  const lines = nonEmptyLines(t).slice(0, LINES);
  const first = lines[0] ?? '';
  const none = { parseOptions: {}, alternatives: [] as SourceFormat[] };

  if (/^<\?xml|^<[!a-zA-Z_]/.test(t)) {
    if (/^<!doctype html|^<html/i.test(t) || /<table[\s>]/i.test(t.slice(0, 200_000)) || /<\/(p|div|body)>/i.test(t.slice(0, 50_000))) {
      return { format: 'xml', confidence: 'unsure', ...none, reason: 'This looks like a web page. Puddle reads tables from web pages through Add source › From web page, or paste the table.' };
    }
    return { format: 'xml', confidence: 'sure', ...none, reason: 'Starts with an XML tag.' };
  }
  if (t.startsWith('[')) return { format: 'json', confidence: 'sure', ...none, reason: 'Starts with a JSON array.' };
  if (t.startsWith('{')) {
    const objects = lines.filter((l) => /^\{.*\}\s*,?$/.test(l.trim()));
    if (lines.length >= 2 && objects.length === lines.length) return { format: 'ndjson', confidence: 'sure', ...none, reason: 'One JSON object per line.' };
    return { format: 'json', confidence: 'sure', ...none, reason: 'Starts with a JSON object.' };
  }

  // A pipe table (an SAP list, a Markdown table): rows between pipes, with rules of dashes. Read by src/sources/pipes.ts,
  // which drops the lines around the table, the empty edge columns and the padding.
  const piped = lines.filter((l) => /^\s*\|.*\|\s*$/.test(l)).length;
  if (lines.length >= 3 && piped >= lines.length * 0.5) {
    const around = lines.length - piped;
    return { format: 'pipes', confidence: 'likely', ...none, reason: `Rows between pipes, as an SAP list or a pipe table has them${around ? `, with ${around} ${around === 1 ? 'line' : 'lines'} around the table` : ''}.` };
  }

  // Fixed-width: lines of much the same length with columns of spaces at the same offsets. Read by src/sources/fixedWidth.ts.
  // Looked for first, since the thousands separators in a column of amounts make a comma-separated file of two fields:
  // columns lined up with spaces win over commas when there are more of them.
  const fixed = lines.length >= 5 && fixedWidthColumns(lines) >= 1 ? detectBoundaries(lines) : [];
  const found = sniffDelimiter(lines);
  if (found && found.fields >= 2 && !(found.delimiter === ',' && fixed.length + 1 > found.fields)) {
    const shape = sniffShape(raw, tailRaw, found.delimiter, found.fields);
    // The header question is asked of the table itself, not of the banner above it.
    const table = lines.filter((l) => countOutsideQuotes(l, found.delimiter) + 1 >= found.fields);
    const header = sniffHeader(table, found.delimiter);
    const parseOptions: ParseOptions = { ...(found.delimiter === ',' ? {} : found.delimiter === '\t' ? {} : { delimiter: found.delimiter }), ...(header === false ? { header: false } : {}), ...shapeOptions(shape, raw, found.delimiter, found.fields, header) };
    const label = { ',': 'commas', '\t': 'tabs', ';': 'semicolons', '|': 'pipes' }[found.delimiter] ?? found.delimiter;
    return {
      format: found.delimiter === '\t' ? 'tsv' : 'csv',
      confidence: found.share >= 0.9 ? 'sure' : 'likely',
      parseOptions,
      alternatives: [],
      reason: withNotes(`${found.fields} values a line, separated by ${label}${header === false ? '; the first row is data, not a header' : ''}.`, shape),
    };
  }

  if (fixed.length) return { format: 'fixed', confidence: 'likely', parseOptions: { boundaries: fixed }, alternatives: [], reason: `${fixed.length + 1} columns at fixed positions, lined up with spaces.` };
  if (/^---\s*$/m.test(first) || lines.filter((l) => /^\s*[\w.-]+:(\s|$)/.test(l)).length >= lines.length * 0.6) {
    return { format: 'csv', confidence: 'unsure', ...none, reason: 'Looks like YAML, which Puddle doesn’t read. Choose a format, or save the data as CSV.' };
  }
  return { format: 'csv', confidence: 'unsure', ...none, reason: lines.length ? 'Plain lines with no separator Puddle recognises.' : 'The file is empty.' };
}

/** How many offsets have a space on every line, between runs of other characters, across lines of a similar length. */
export function fixedWidthColumns(lines: string[]): number {
  const width = Math.max(...lines.map((l) => l.length));
  const sample = lines.filter((l) => l.length >= width * 0.8);
  if (sample.length < lines.length * 0.6) return 0;
  let columns = 0;
  let inGap = false;
  for (let i = 0; i < width; i++) {
    const allSpace = sample.every((l) => (l[i] ?? ' ') === ' ');
    if (allSpace && !inGap) {
      inGap = true;
    } else if (!allSpace && inGap) {
      inGap = false;
      if (i > 0) columns++;
    }
  }
  return columns;
}

/**
 * The format and read options a file wants, from its name, its first megabyte and its size. Throws a SourceError, in
 * plain words, for a file Puddle can name but not read.
 */
export function sniff({ name, head, size, tail }: SniffInput): Sniffed {
  const byName = knownFormat(name);
  const signature = signatureOf(head);
  if (signature) {
    if (signature === 'xlsx' || signature === 'parquet' || signature === 'access') {
      return { format: signature, confidence: 'sure', parseOptions: {}, alternatives: [], reason: `A ${signature === 'xlsx' ? 'workbook' : signature === 'parquet' ? 'Parquet file' : 'database'} by its signature.` };
    }
    throw refusal(name, signature === 'ole' && /\.xls$/i.test(name) ? 'xls' : (signature as OtherFormat));
  }
  if (!head.length) {
    if (byName) return { format: byName, confidence: 'likely', parseOptions: {}, alternatives: [], reason: 'The file is empty.' };
    throw new SourceError(`${name} is empty. ${READS}`);
  }
  const decoded = decodeHead(head, size == null || size <= head.length);
  if ('binary' in decoded) {
    if (byName === 'parquet' || byName === 'xlsx' || byName === 'access') return { format: byName, confidence: 'likely', parseOptions: {}, alternatives: [], reason: 'Taken from the file name.' };
    throw refusal(name, 'binary');
  }
  const encoding: ParseOptions = decoded.encoding ? { encoding: decoded.encoding } : {};
  const whole = size == null || size <= head.length;
  const tailText = whole ? undefined : tail ? decodeTail(tail, decoded.encoding) : undefined;
  // The head is the whole file, so its lines are the tail too: the footer is read from them.
  const content = sniffText(decoded.text, whole ? decoded.text : tailText);
  const parseOptions = { ...content.parseOptions, ...encoding };
  // Content and name agree, or the name says nothing: the content's word, with its confidence.
  if (!byName || byName === content.format || (byName === 'tsv' && content.format === 'csv' && content.parseOptions.delimiter == null && content.confidence === 'unsure')) {
    const sure = byName === content.format && content.confidence !== 'unsure' ? 'sure' : content.confidence;
    if (byName && content.confidence === 'unsure') return { ...content, format: byName, confidence: 'likely', parseOptions: encoding, reason: `${content.reason} Read as ${byName.toUpperCase()}, as the file name says.` };
    return { ...content, confidence: sure, parseOptions };
  }
  // They disagree. Unambiguous content wins (D24): JSON named .csv reads as JSON. Otherwise the name has the final say.
  if (content.confidence === 'sure') return { ...content, parseOptions, alternatives: [byName], reason: `${content.reason} The name says ${byName.toUpperCase()}, but the content doesn’t.` };
  if (content.confidence === 'likely') return { ...content, parseOptions, confidence: 'unsure', alternatives: [byName], reason: `${content.reason} The name says ${byName.toUpperCase()}.` };
  return { format: byName, confidence: 'likely', parseOptions: encoding, alternatives: [], reason: `${content.reason} Read as ${byName.toUpperCase()}, as the file name says.` };
}

/** The last bytes of a file as text, in the encoding the head settled; a UTF-16 cut on an odd byte starts one later. */
function decodeTail(tail: Uint8Array, encoding: Decoded['encoding']): string {
  if (encoding === 'utf-16') return new TextDecoder('utf-16le').decode(tail.length % 2 ? tail.subarray(1) : tail);
  return new TextDecoder(encoding === 'latin-1' ? 'windows-1252' : 'utf-8').decode(tail);
}

/** How many bytes of the end of a file the sniff wants, for the footer. */
export const TAIL_BYTES = 64 * 1024;

/** The sniff for pasted text, which has no name: TSV from a spreadsheet, JSON, XML or CSV. */
export const sniffPasted = (text: string): Sniffed => sniffText(text, text);
