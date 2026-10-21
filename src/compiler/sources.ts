import { hashValue, type Source } from '../model';
import { CompileError } from './errors';
import { bool, ident, num, str, strList } from './sql';

const ROW = ident('__puddle_row');
const TOTAL = ident('__puddle_total');

const EXT: Record<Source['format'], string> = { csv: 'csv', tsv: 'tsv', json: 'json', ndjson: 'ndjson', parquet: 'parquet', xlsx: 'xlsx', xml: 'csv', access: 'accdb', connection: 'table', fixed: 'csv', pipes: 'csv', arrow: 'arrow', yaml: 'csv', toml: 'csv', ini: 'csv', geojson: 'csv', word: 'csv', log: 'csv', pdf: 'csv' };

/**
 * A gzip-compressed text file DuckDB reads as it is (CSV, TSV, JSON, NDJSON): registered with its .gz, it is unpacked
 * as it is read, never whole into memory. Anything else in an archive is unpacked first (src/sources/archive.ts).
 */
export const readsCompressed = (source: Pick<Source, 'format' | 'archive'>) => source.archive?.kind === 'gzip' && (source.format === 'csv' || source.format === 'tsv' || source.format === 'json' || source.format === 'ndjson');

/** Excel, Access and Arrow are loaded into a DuckDB table (sourceTableName) rather than read from a file. */
export const isLoadedTable = (format: Source['format']) => format === 'xlsx' || format === 'access' || format === 'arrow';

/** Formats Puddle reads into rows itself and hands DuckDB as CSV: XML, fixed-width text, pipe tables, structured text (YAML, TOML, INI, GeoJSON), the tables of a Word document or a PDF, and log files. */
export const isRewritten = (format: Source['format']) => format === 'xml' || format === 'fixed' || format === 'pipes' || format === 'word' || format === 'pdf' || format === 'log' || isStructured(format);

export const isStructured = (format: Source['format']) => format === 'yaml' || format === 'toml' || format === 'ini' || format === 'geojson';

/**
 * The name a source's file is registered under in DuckDB's virtual file system. XML, fixed-width text and a pipe
 * table are registered as the CSV their rows were read into, under a name that follows the file and the read
 * options (as sourceTableName does for Excel), so rows read with other options are never mistaken for them.
 */
export function sourceFileName(source: Source): string {
  const o = source.parseOptions;
  const hash = source.file?.headHash ?? source.url?.headHash ?? null;
  // A file from an archive is named for the entry too, so another entry of the same archive is never mistaken for it.
  const entry = source.archive ? [source.archive.entry] : [];
  if (source.format === 'xml') return `src_${source.id}_${hashValue([hash, ...entry, o.record ?? null, o.expand ?? null]).slice(0, 12)}.csv`;
  if (source.format === 'fixed') return `src_${source.id}_${hashValue([hash, ...entry, 'fixed', o.boundaries ?? null, o.header ?? null, o.skip ?? null, o.skipBottom ?? null, o.encoding ?? null]).slice(0, 12)}.csv`;
  if (source.format === 'pipes') return `src_${source.id}_${hashValue([hash, ...entry, 'pipes', o.header ?? null, o.encoding ?? null]).slice(0, 12)}.csv`;
  if (isStructured(source.format)) return `src_${source.id}_${hashValue([hash, ...entry, source.format, o.record ?? null, o.encoding ?? null]).slice(0, 12)}.csv`;
  if (source.format === 'log') return `src_${source.id}_${hashValue([hash, ...entry, 'log', o.preset ?? null, o.pattern ?? null, o.encoding ?? null]).slice(0, 12)}.csv`;
  if (source.format === 'word' || source.format === 'pdf') return `src_${source.id}_${hashValue([hash, ...entry, source.format, o.table ?? null, o.header ?? null]).slice(0, 12)}.csv`;
  if (source.archive) return `src_${source.id}_${hashValue([hash, ...entry]).slice(0, 12)}.${EXT[source.format]}${readsCompressed(source) ? '.gz' : ''}`;
  return `src_${source.id}.${EXT[source.format]}`;
}

/**
 * Excel is parsed by SheetJS into an Arrow table and registered as a table, not read as a file, and so is a table
 * of an Access database (read by mdb-reader). The name follows the file and the read options, so a table read with
 * other options (or from another file) is never mistaken for it.
 */
export function sourceTableName(source: Source): string {
  const o = source.parseOptions;
  const c = source.connection;
  const hash = source.file?.headHash ?? source.url?.headHash ?? null;
  const entry = source.archive ? [source.archive.entry] : [];
  const key = c
    ? [c.connectionId, c.table?.schema ?? null, c.table?.name ?? null, c.query ?? null, c.limit ?? null, c.filter ?? null, c.allowFiltering ?? null, c.shape?.depth ?? null, c.shape?.arrays ?? null]
    : source.format === 'access' ? [hash, ...entry, 'access', o.table ?? null] : source.format === 'arrow' ? [hash, ...entry, 'arrow'] : [hash, ...entry, o.sheet ?? null, o.headerRow ?? null, o.range ?? null, o.headerRows ?? null, o.fillMerges ?? null];
  return `src_${source.id}_${hashValue(key).slice(0, 12)}`;
}

/** The types an Access table's columns may be loaded as: a name, or a decimal with its precision and scale. */
const ACCESS_TYPE = /^(BOOLEAN|UTINYINT|SMALLINT|INTEGER|BIGINT|FLOAT|DOUBLE|DATE|TIMESTAMP|BLOB|VARCHAR|DECIMAL\(\d{1,2},\d{1,2}\))$/;

/**
 * Load an Access table (or, on the runner, a sheet) into `table`, giving each column its type: Currency and Decimal
 * arrive as exact text and become decimals, whole numbers keep their Access size. The browser loads it from the
 * Arrow rows it arrived as (a staging table); the runner from the CSV it wrote them to (every value as text, see
 * src/access/csv.ts).
 */
export function compileAccessLoad(table: string, columns: { name: string; sqlType: string }[], from: { staging: string } | { csv: string }): string {
  const list = columns.map((c) => `CAST(${ident(c.name)} AS ${ACCESS_TYPE.test(c.sqlType) ? c.sqlType : 'VARCHAR'}) AS ${ident(c.name)}`);
  const relation = 'staging' in from ? ident(from.staging) : `read_csv(${str(from.csv)}, header = true, all_varchar = true, delim = ',', quote = '"', escape = '"', allow_quoted_nulls = false)`;
  return `CREATE OR REPLACE TABLE ${ident(table)} AS SELECT ${list.length ? list.join(', ') : '*'} FROM ${relation}`;
}

/** Drop a source's table (an Excel sheet read with options no longer in use). */
export const dropTable = (name: string) => `DROP TABLE IF EXISTS ${ident(name)}`;

/** The table function call that reads a source, e.g. read_csv('src_a.csv', delim = ','). */
export function sourceRelation(source: Source): string {
  const file = str(sourceFileName(source));
  const o = source.parseOptions;
  const odata = source.url?.odata;
  if (odata) {
    // An OData feed, written as CSV by src/sources/odata.ts: a header row, quoted empty strings kept apart from nulls,
    // and the column types from the service's $metadata where it has one (else DuckDB types the columns).
    const args = [file, 'header = true', `delim = ','`, `quote = '"'`, `escape = '"'`, 'allow_quoted_nulls = false'];
    if (odata.columns?.length) args.push(`columns = {${odata.columns.map((c) => `${str(c.name)}: ${str(c.type)}`).join(', ')}}`);
    return `read_csv(${args.join(', ')})`;
  }
  switch (source.format) {
    case 'csv':
    case 'tsv': {
      const args = [file];
      const delimiter = o.delimiter ?? (source.format === 'tsv' ? '\t' : undefined);
      if (delimiter != null) args.push(`delim = ${str(delimiter)}`);
      if (o.header != null) args.push(`header = ${bool(o.header)}`);
      if (o.quote != null) args.push(`quote = ${str(o.quote)}`);
      if (o.encoding != null) args.push(`encoding = ${str(o.encoding)}`);
      // An empty field stays empty: DuckDB's own null string is '', and naming others would otherwise drop it.
      if (o.nullStrings?.length) args.push(`nullstr = ${strList([...new Set(['', ...o.nullStrings])])}`);
      if (o.skip) args.push(`skip = ${num(o.skip)}`);
      if (readsCompressed(source)) args.push(`compression = 'gzip'`);
      // With a banner skipped, DuckDB's sniffer fails on a ragged row below, so the columns are given outright: the
      // names the file's own sniff read from the header line, every one as text (the steps type them after).
      // Ragged rows (a header with a trailing comma, an unquoted comma in one value) otherwise make the sniffer give
      // up on the delimiter and read each line as one column, or fail outright when the delimiter is set.
      // Short rows are padded with empty values instead, as Power Query does.
      args.push('null_padding = true');
      // A file with a banner is also read in DuckDB's lenient mode, which takes mixed line endings and a row with
      // too many values (dropped past the last column); strict mode fails on both. Lenient mode misreads a quote
      // inside a value, so a plain file keeps the strict one.
      if (o.columns?.length) {
        if (o.header == null) args.push('header = true');
        args.push('auto_detect = false', `columns = {${o.columns.map((c) => `${str(c)}: 'VARCHAR'`).join(', ')}}`, 'strict_mode = false');
      }
      const relation = `read_csv(${args.join(', ')})`;
      // A footer: the last rows go, counted from the end in file order (DuckDB reads a file in order on one thread).
      if (o.skipBottom) return `(SELECT * EXCLUDE (${ROW}, ${TOTAL}) FROM (SELECT *, row_number() OVER () AS ${ROW}, count(*) OVER () AS ${TOTAL} FROM ${relation}) WHERE ${ROW} <= ${TOTAL} - ${num(o.skipBottom)})`;
      return relation;
    }
    case 'json':
      return `read_json_auto(${[file, ...(readsCompressed(source) ? [`compression = 'gzip'`] : [])].join(', ')})`;
    case 'ndjson':
      return `read_json_auto(${[file, `format = 'newline_delimited'`, ...(readsCompressed(source) ? [`compression = 'gzip'`] : [])].join(', ')})`;
    case 'parquet':
      return `read_parquet(${file})`;
    case 'xlsx':
    case 'access':
    case 'connection':
    case 'arrow':
      return ident(sourceTableName(source));
    case 'xml':
      // Written by Puddle from the XML (see src/xml), always with a header row, commas and double quotes.
      return `read_csv(${file}, header = true, delim = ',', quote = '"', escape = '"', null_padding = true)`;
    case 'fixed':
    case 'pipes':
    case 'yaml':
    case 'toml':
    case 'ini':
    case 'geojson':
    case 'word':
    case 'pdf':
    case 'log': {
      // Written by Puddle from the text (src/sources/fixedWidth.ts, pipes.ts, src/structured, src/logs) or the document's table (src/word, src/pdf) the same way; the words for empty apply as on any text.
      const args = [file, 'header = true', `delim = ','`, `quote = '"'`, `escape = '"'`, 'null_padding = true'];
      if (o.nullStrings?.length) args.push(`nullstr = ${strList([...new Set(['', ...o.nullStrings])])}`);
      return `read_csv(${args.join(', ')})`;
    }
    default:
      throw new CompileError(`Unsupported source format: ${String((source as Source).format)}.`);
  }
}
