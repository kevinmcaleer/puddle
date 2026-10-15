import type { Source } from '../model';
import { CompileError } from './errors';
import { bool, ident, str, strList } from './sql';

const EXT: Record<Source['format'], string> = { csv: 'csv', tsv: 'tsv', json: 'json', ndjson: 'ndjson', parquet: 'parquet', xlsx: 'xlsx' };

/** The name a source's file is registered under in DuckDB's virtual file system. */
export function sourceFileName(source: Source): string {
  return `src_${source.id}.${EXT[source.format]}`;
}

/** Excel is parsed by SheetJS into an Arrow table and registered as a table, not read as a file. */
export function sourceTableName(source: Source): string {
  return `src_${source.id}`;
}

/** The table function call that reads a source, e.g. read_csv('src_a.csv', delim = ','). */
export function sourceRelation(source: Source): string {
  const file = str(sourceFileName(source));
  const o = source.parseOptions;
  switch (source.format) {
    case 'csv':
    case 'tsv': {
      const args = [file];
      const delimiter = o.delimiter ?? (source.format === 'tsv' ? '\t' : undefined);
      if (delimiter != null) args.push(`delim = ${str(delimiter)}`);
      if (o.header != null) args.push(`header = ${bool(o.header)}`);
      if (o.quote != null) args.push(`quote = ${str(o.quote)}`);
      if (o.encoding != null) args.push(`encoding = ${str(o.encoding)}`);
      if (o.nullStrings?.length) args.push(`nullstr = ${strList(o.nullStrings)}`);
      return `read_csv(${args.join(', ')})`;
    }
    case 'json':
      return `read_json_auto(${file})`;
    case 'ndjson':
      return `read_json_auto(${file}, format = 'newline_delimited')`;
    case 'parquet':
      return `read_parquet(${file})`;
    case 'xlsx':
      return ident(sourceTableName(source));
    default:
      throw new CompileError(`Unsupported source format: ${String((source as Source).format)}.`);
  }
}
