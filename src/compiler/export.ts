// Exports: an Output node's rows written by DuckDB's COPY ... TO, so the file never passes through JavaScript rows.
import { z } from 'zod';
import { nodeById, type ColumnSchema, type OutputNode, type Project } from '../model';
import { compile, fullData } from './compile';
import { CompileError } from './errors';
import { bool, ident, list, str } from './sql';

export type ExportFormat = OutputNode['outputSpec']['format'];
export type OutputSpec = OutputNode['outputSpec'];

export const EXPORT_FORMATS: Record<ExportFormat, { label: string; ext: string; mime: string }> = {
  csv: { label: 'CSV', ext: 'csv', mime: 'text/csv' },
  parquet: { label: 'Parquet', ext: 'parquet', mime: 'application/vnd.apache.parquet' },
  json: { label: 'JSON', ext: 'json', mime: 'application/json' },
  ndjson: { label: 'NDJSON', ext: 'ndjson', mime: 'application/x-ndjson' },
  clipboard: { label: 'Clipboard', ext: 'tsv', mime: 'text/tab-separated-values' },
  xlsx: { label: 'Excel', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
};

export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;
export const PARQUET_COMPRESSION = ['zstd', 'snappy', 'uncompressed'] as const;

const CsvOptions = z.object({ delimiter: z.enum(CSV_DELIMITERS).default(','), header: z.boolean().default(true) });
const ParquetOptions = z.object({ compression: z.enum(PARQUET_COMPRESSION).default('zstd') });
const ClipboardOptions = z.object({ header: z.boolean().default(true) });
/** Excel: the sheet's name (the Output node's name when unset), a header row, and keeping that row in view. */
const XlsxOptions = z.object({ sheetName: z.string().optional(), header: z.boolean().default(true), freezeHeader: z.boolean().default(true) });
export type XlsxExportOptions = z.infer<typeof XlsxOptions>;

/** Each format's options with their defaults filled in; unknown keys are dropped. */
export function exportOptions(spec: Pick<OutputSpec, 'format' | 'options'>) {
  const parse = <T>(schema: z.ZodType<T>) => {
    const r = schema.safeParse(spec.options);
    if (!r.success) throw new CompileError(`The ${EXPORT_FORMATS[spec.format].label} options are invalid: ${r.error.issues[0]?.message ?? 'check them'}.`);
    return r.data;
  };
  switch (spec.format) {
    case 'csv':
      return parse(CsvOptions);
    case 'parquet':
      return parse(ParquetOptions);
    case 'clipboard':
      return parse(ClipboardOptions);
    case 'xlsx':
      return parse(XlsxOptions);
    default:
      return {};
  }
}

/** The COPY options DuckDB takes for a spec. */
function copyOptions(spec: Pick<OutputSpec, 'format' | 'options'>): string {
  switch (spec.format) {
    case 'csv': {
      const o = exportOptions(spec) as z.infer<typeof CsvOptions>;
      return `FORMAT csv, HEADER ${bool(o.header)}, DELIMITER ${str(o.delimiter)}`;
    }
    case 'clipboard': {
      // Tab-separated, so it pastes into spreadsheet cells.
      const o = exportOptions(spec) as z.infer<typeof ClipboardOptions>;
      return `FORMAT csv, HEADER ${bool(o.header)}, DELIMITER '\t'`;
    }
    case 'parquet': {
      const o = exportOptions(spec) as z.infer<typeof ParquetOptions>;
      return `FORMAT parquet, COMPRESSION ${o.compression}`;
    }
    case 'json':
      return 'FORMAT json, ARRAY true';
    case 'ndjson':
      return 'FORMAT json';
    case 'xlsx':
      throw new CompileError('Excel workbooks are written by SheetJS, not COPY. Use compileSheetExport.');
  }
}

/** Write an Output node's rows to `path` in its format. DuckDB answers with the number of rows written. */
export function compileExport(project: Project, nodeId: string, path: string, spec?: Pick<OutputSpec, 'format' | 'options'>): string {
  const node = project.nodes.find((n) => n.id === nodeId);
  if (!node) throw new CompileError('That node is no longer in the project.', nodeId);
  const s = spec ?? (node.type === 'output' ? node.outputSpec : undefined);
  if (!s) throw new CompileError(`${node.name} isn’t an Output node.`, nodeId);
  return `COPY (${compile(fullData(project), { nodeId }).sql}) TO ${str(path)} (${copyOptions(s)})`;
}

/** DuckDB types an Excel cell holds as they are (numbers, booleans, dates, date-times, text). */
const SHEET_TYPES = /^(BOOLEAN|TINYINT|SMALLINT|INTEGER|BIGINT|UTINYINT|USMALLINT|UINTEGER|FLOAT|REAL|DOUBLE|VARCHAR|DATE|TIMESTAMP)$/;

/** A column as Excel can hold it: decimals as numbers, other timestamps as plain ones, anything else as text. */
export function sheetColumn(c: ColumnSchema): string {
  const t = c.type.toUpperCase();
  const col = ident(c.name);
  if (SHEET_TYPES.test(t)) return col;
  if (/^DECIMAL|^NUMERIC/.test(t)) return `CAST(${col} AS DOUBLE) AS ${col}`;
  if (/^TIMESTAMP/.test(t)) return `CAST(${col} AS TIMESTAMP) AS ${col}`;
  return `CAST(${col} AS VARCHAR) AS ${col}`;
}

/** The query whose rows an Excel export writes, given the Output node's columns (from DESCRIBE). */
export function compileSheetExport(project: Project, nodeId: string, columns: ColumnSchema[]): string {
  if (!nodeById(project, nodeId)) throw new CompileError('That node is no longer in the project.', nodeId);
  return `SELECT ${list(columns.map(sheetColumn))} FROM (${compile(fullData(project), { nodeId }).sql})`;
}

/** How many rows an Output node exports, on the full data. */
export const compileFullCount = (project: Project, nodeId: string): string => `SELECT COUNT(*) AS n FROM (${compile(fullData(project), { nodeId }).sql})`;

/** The Output node's full query (never a sample), e.g. to DESCRIBE it before an Excel export. */
export const compileFullData = (project: Project, nodeId: string): string => compile(fullData(project), { nodeId }).sql;

/** A safe file name for an export: the one given, or the node's name, always with the format's extension. */
export function exportFileName(name: string, spec: Pick<OutputSpec, 'format' | 'fileName'>): string {
  const ext = EXPORT_FORMATS[spec.format].ext;
  const printable = [...(spec.fileName?.trim() || name.trim() || 'export')].filter((c) => c.charCodeAt(0) >= 32).join('');
  const base = printable
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\.+$/, '')
    .trim();
  // A name that already ends in an export extension ("customers.csv") swaps it for this format's.
  const known = Object.values(EXPORT_FORMATS).map((f) => `.${f.ext}`).find((e) => base.toLowerCase().endsWith(e));
  const stem = known ? base.slice(0, -known.length) : base;
  return `${stem || 'export'}.${ext}`;
}
