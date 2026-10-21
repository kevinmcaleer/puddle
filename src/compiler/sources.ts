import { hashValue, type Source } from '../model';
import { CompileError } from './errors';
import { bool, ident, num, str, strList } from './sql';

const ROW = ident('__puddle_row');
const TOTAL = ident('__puddle_total');

const EXT: Record<Source['format'], string> = { csv: 'csv', tsv: 'tsv', json: 'json', ndjson: 'ndjson', parquet: 'parquet', xlsx: 'xlsx', xml: 'csv', access: 'accdb', connection: 'table' };

/**
 * The name a source's file is registered under in DuckDB's virtual file system. XML is registered as the CSV its
 * records were read into, under a name that follows the file and the read options (as sourceTableName does for
 * Excel), so rows read with other options are never mistaken for them.
 */
export function sourceFileName(source: Source): string {
  if (source.format === 'xml') {
    const o = source.parseOptions;
    return `src_${source.id}_${hashValue([source.file?.headHash ?? source.url?.headHash ?? null, o.record ?? null, o.expand ?? null]).slice(0, 12)}.csv`;
  }
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
  const key = c
    ? [c.connectionId, c.table?.schema ?? null, c.table?.name ?? null, c.query ?? null, c.limit ?? null, c.filter ?? null, c.allowFiltering ?? null, c.shape?.depth ?? null, c.shape?.arrays ?? null]
    : source.format === 'access' ? [source.file?.headHash ?? null, 'access', o.table ?? null] : [source.file?.headHash ?? null, o.sheet ?? null, o.headerRow ?? null, o.range ?? null];
  return `src_${source.id}_${hashValue(key).slice(0, 12)}`;
}

/** The types an Access table's columns may be loaded as: a name, or a decimal with its precision and scale. */
const ACCESS_TYPE = /^(BOOLEAN|UTINYINT|SMALLINT|INTEGER|BIGINT|FLOAT|DOUBLE|TIMESTAMP|BLOB|VARCHAR|DECIMAL\(\d{1,2},\d{1,2}\))$/;

/**
 * Load an Access table into `table`, giving each column its Access type: Currency and Decimal arrive as exact text
 * and become decimals, whole numbers keep their Access size. The browser loads it from the Arrow rows it arrived as
 * (a staging table); the runner from the CSV it wrote them to (every value as text, see src/access/csv.ts).
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
      return `read_json_auto(${file})`;
    case 'ndjson':
      return `read_json_auto(${file}, format = 'newline_delimited')`;
    case 'parquet':
      return `read_parquet(${file})`;
    case 'xlsx':
    case 'access':
    case 'connection':
      return ident(sourceTableName(source));
    case 'xml':
      // Written by Puddle from the XML (see src/xml), always with a header row, commas and double quotes.
      return `read_csv(${file}, header = true, delim = ',', quote = '"', escape = '"', null_padding = true)`;
    default:
      throw new CompileError(`Unsupported source format: ${String((source as Source).format)}.`);
  }
}
