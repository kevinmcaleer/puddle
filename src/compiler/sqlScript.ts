// SQL scripts in a SQL node: CREATE TABLE name AS ... statements, each a table the statements after it can read,
// then optionally a last query; and the files of wired file sources, read by name (read_parquet('*.parquet')).
//
// A script never runs as statements. Each table becomes a CTE, so the script stays one SELECT the compiler can
// chain, cache and stop like any other node, and nothing it does outlives the query. A file read is lifted out of
// the query into a CTE of its own that reads exactly the wired files its name or pattern matches; what remains is
// checked by customSqlProblem like any SQL node's query, so the script still can't reach anything else.
import { cleanCustomSql, customSqlProblem, lexSql, SqlRefusal, type SqlToken } from './customSql';
import { globMatches, isGlob } from './fileSet';
import { sqlInputNames, type SqlInput } from './sqlNode';
import { ident, strList } from './sql';
import { CUSTOM_SQL_OPENER } from './steps/advanced';

/** A file a SQL node may read by name: its name as chosen, and the name DuckDB has it registered under. */
export interface ScriptFile {
  name: string;
  registered: string;
}

/** One statement of a script: the table it creates (none for a last query) and its query, as written. */
export interface ScriptStatement {
  table?: string;
  /** The table's name as written, for messages. */
  label?: string;
  query: string;
}

const end = (t: SqlToken) => t.start + t.text.length;
const isName = (t: SqlToken | undefined): t is SqlToken => !!t && (t.kind === 'word' || t.kind === 'quoted');

/**
 * The statements of a query split at its semicolons (comments and strings respected), each read as CREATE [OR REPLACE]
 * TABLE name AS query, or as a query. Returns a reason when the text can't be read that way.
 */
export function splitScript(sql: string): { statements: ScriptStatement[] } | { problem: string } {
  let tokens: SqlToken[];
  try {
    tokens = lexSql(sql);
  } catch (e) {
    if (e instanceof SqlRefusal) return { problem: e.message };
    throw e;
  }
  const chunks: SqlToken[][] = [[]];
  for (const t of tokens) {
    if (t.kind === 'op' && t.text === ';') chunks.push([]);
    else chunks[chunks.length - 1]!.push(t);
  }
  const statements: ScriptStatement[] = [];
  for (const chunk of chunks) {
    const words = chunk.filter((t) => t.kind !== 'comment');
    if (!words.length) continue;
    const from = words[0]!.start;
    const to = end(words[words.length - 1]!);
    if (words[0]!.value !== 'create' || words[0]!.kind !== 'word') {
      statements.push({ query: sql.slice(from, to) });
      continue;
    }
    // CREATE [OR REPLACE] [TEMP | TEMPORARY] TABLE | VIEW [IF NOT EXISTS] name AS query
    let k = 1;
    const word = (v: string) => words[k]?.kind === 'word' && words[k]!.value === v;
    if (word('or') && words[k + 1]?.value === 'replace') k += 2;
    if (word('temp') || word('temporary')) k++;
    if (!word('table') && !word('view')) return { problem: `${shown(words, 0, k + 1)} isn’t something a script can do: it can only CREATE TABLE name AS a query` };
    k++;
    if (word('if') && words[k + 1]?.value === 'not' && words[k + 2]?.value === 'exists') k += 3;
    const name = words[k];
    if (!isName(name)) return { problem: 'name the table: CREATE TABLE name AS SELECT ...' };
    if (words[k + 1]?.text === '.') return { problem: `create ${name.text} without a schema or database: CREATE TABLE ${words[k + 2]?.text ?? 'name'} AS SELECT ...` };
    const as = words[k + 1];
    if (!as || as.kind !== 'word' || as.value !== 'as') return { problem: `give ${name.text} its rows with AS and a query: CREATE TABLE ${name.text} AS SELECT ... (a script can’t declare columns or insert rows)` };
    if (!words[k + 2]) return { problem: `write the query ${name.text} is made from after AS` };
    statements.push({ table: name.value, label: name.kind === 'quoted' ? name.text.slice(1, -1).replace(/""/g, '"') : name.text, query: sql.slice(words[k + 2]!.start, to) });
  }
  return { statements };
}

const shown = (tokens: SqlToken[], from: number, to: number) => tokens.slice(from, to).map((t) => t.text.toUpperCase()).join(' ');

/** True when a SQL node's query is a script: more than one statement, or a CREATE TABLE. */
export function isScript(sql: string): boolean {
  const split = splitScript(sql);
  return 'problem' in split ? /^\s*create\b/i.test(sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '')) || /;\s*\S/.test(sql) : split.statements.length > 1 || split.statements.some((s) => s.table);
}

/** The tables a script creates, in order, as written. Empty for a single query, or a script that can't be read. */
export function scriptTables(sql: string): string[] {
  const split = splitScript(sql);
  return 'problem' in split ? [] : split.statements.flatMap((s) => (s.label ? [s.label] : []));
}

/** Functions that read files, and the reader each one stands for. */
const FILE_READERS: Record<string, string> = {
  read_parquet: 'read_parquet',
  parquet_scan: 'read_parquet',
  read_csv: 'read_csv',
  read_csv_auto: 'read_csv',
  read_json: 'read_json',
  read_json_auto: 'read_json_auto',
  read_ndjson: 'read_ndjson',
  read_ndjson_auto: 'read_ndjson_auto',
};

/**
 * The options a file read may pass on, which all shape how the files are read and none of which names another file
 * or runs anything. Their values may only be literals.
 */
const READ_OPTIONS = new Set([
  'union_by_name', 'filename', 'hive_partitioning', 'hive_types_autocast', 'binary_as_string', 'file_row_number',
  'delim', 'sep', 'header', 'quote', 'escape', 'nullstr', 'skip', 'all_varchar', 'auto_detect', 'columns', 'types', 'dtypes', 'column_types', 'names', 'column_names',
  'dateformat', 'timestampformat', 'decimal_separator', 'new_line', 'normalize_names', 'null_padding', 'ignore_errors', 'strict_mode', 'max_line_size', 'sample_size',
  'encoding', 'compression', 'parallel', 'allow_quoted_nulls', 'comment', 'thousands', 'auto_type_candidates', 'rejects_limit', 'store_rejects',
  'format', 'records', 'maximum_depth', 'maximum_object_size', 'convert_strings_to_integers', 'field_appearance_threshold', 'map_inference_threshold',
]);

/** The reader for a file named after FROM, by its extension. */
function readerByName(name: string): { fn: string; options: string[] } | undefined {
  const lower = name.toLowerCase().replace(/\.gz$/, '');
  if (lower.endsWith('.parquet')) return { fn: 'read_parquet', options: [] };
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) return { fn: 'read_csv', options: [] };
  if (lower.endsWith('.json')) return { fn: 'read_json_auto', options: [] };
  if (lower.endsWith('.ndjson') || lower.endsWith('.jsonl')) return { fn: 'read_json_auto', options: [`format = 'newline_delimited'`] };
  return undefined;
}

/** A file read lifted out of a query: the CTE it becomes and the call that reads the files. */
export interface FileRead {
  cte: string;
  relation: string;
}

/** The wired files a name or pattern means, in order. */
function filesFor(pattern: string, files: ScriptFile[]): ScriptFile[] {
  if (isGlob(pattern)) return files.filter((f) => globMatches(pattern, f.name));
  const lower = pattern.toLowerCase().replace(/\\/g, '/').replace(/^\.\//, '');
  const exact = files.filter((f) => f.name.toLowerCase() === lower);
  return exact.length ? exact : files.filter((f) => (f.name.split('/').pop() ?? '').toLowerCase() === lower);
}

function noFile(pattern: string, files: ScriptFile[]): string {
  if (!files.length) return `there are no files to read ${pattern} from: wire a file set, or a file source, into this node`;
  return `no file wired into this node ${isGlob(pattern) ? 'matches' : 'is called'} ${pattern}`;
}

/**
 * Lift every file read out of a query: read_parquet('*.parquet', union_by_name = true) and FROM 'users.parquet' become
 * a CTE name, and the CTE reads the wired files the names match. `next` numbers the CTEs across a script.
 */
export function liftFileReads(query: string, files: ScriptFile[], next: () => string): { query: string; reads: FileRead[] } | { problem: string } {
  let tokens: SqlToken[];
  try {
    tokens = lexSql(query).filter((t) => t.kind !== 'comment');
  } catch (e) {
    if (e instanceof SqlRefusal) return { problem: e.message };
    throw e;
  }
  const reads: FileRead[] = [];
  const edits: { from: number; to: number; text: string }[] = [];
  const resolve = (patterns: string[]): ScriptFile[] | string => {
    const found: ScriptFile[] = [];
    for (const p of patterns) {
      const matched = filesFor(p, files);
      if (!matched.length) return noFile(p, files);
      for (const f of matched) if (!found.includes(f)) found.push(f);
    }
    return found;
  };
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]!;
    const prev = tokens[k - 1];
    if (t.kind === 'word' && FILE_READERS[t.value] && tokens[k + 1]?.text === '(' && prev?.text !== '.') {
      // reader ( 'name' | ['a', 'b'] [, option = literal]... )
      let j = k + 2;
      const patterns: string[] = [];
      if (tokens[j]?.kind === 'string') patterns.push(tokens[j++]!.value);
      else if (tokens[j]?.text === '[') {
        j++;
        while (tokens[j]?.kind === 'string') {
          patterns.push(tokens[j++]!.value);
          if (tokens[j]?.text === ',') j++;
        }
        if (tokens[j]?.text !== ']' || !patterns.length) return { problem: `give ${t.text}() the file names to read as text, such as ${t.text}('*.parquet')` };
        j++;
      } else return { problem: `give ${t.text}() the file name to read as text, such as ${t.text}('*.parquet')` };
      const optionsFrom = j;
      let depth = 0;
      for (; j < tokens.length; j++) {
        const o = tokens[j]!;
        if (o.text === '(' ) return { problem: `${t.text}()’s options can only be plain values` };
        if (o.text === ')' && depth === 0) break;
        if (o.text === '[' || o.text === '{') depth++;
        else if (o.text === ']' || o.text === '}') depth--;
        else if (o.kind === 'word' && tokens[j + 1]?.text === '=' && depth === 0 && tokens[j - 1]?.text === ',') {
          if (!READ_OPTIONS.has(o.value)) return { problem: `${t.text}() can’t take ${o.text} here` };
        } else if (o.kind === 'word' && !['true', 'false', 'null'].includes(o.value) && depth === 0) return { problem: `${t.text}()’s options are written option = value, such as union_by_name = true` };
      }
      if (tokens[j]?.text !== ')') return { problem: `close ${t.text}( with )` };
      const matched = resolve(patterns);
      if (typeof matched === 'string') return { problem: matched };
      const options = query.slice(end(tokens[optionsFrom - 1]!), tokens[j]!.start).trim();
      const cte = next();
      reads.push({ cte, relation: `${FILE_READERS[t.value]}(${strList(matched.map((f) => f.registered))}${options ? (options.startsWith(',') ? options : `, ${options}`) : ''})` });
      edits.push({ from: t.start, to: end(tokens[j]!), text: ident(cte) });
      k = j;
      continue;
    }
    if (t.kind === 'string' && prev?.kind === 'word' && (prev.value === 'from' || prev.value === 'join')) {
      // FROM 'users.parquet', as DuckDB reads a file named in place of a table.
      const reader = readerByName(t.value);
      if (!reader) return { problem: `read ${t.text} with read_csv, read_parquet or read_json: its name doesn’t say what kind of file it is` };
      const matched = resolve([t.value]);
      if (typeof matched === 'string') return { problem: matched };
      const cte = next();
      reads.push({ cte, relation: `${reader.fn}(${[strList(matched.map((f) => f.registered)), ...(matched.length > 1 ? ['union_by_name = true'] : []), ...reader.options].join(', ')})` });
      edits.push({ from: t.start, to: end(t), text: ident(cte) });
    }
  }
  let out = query;
  for (const e of edits.reverse()) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return { query: out, reads };
}

/** A script read and checked: per statement, its query with file reads lifted out and the CTEs they became. */
export interface ReadScript {
  statements: (ScriptStatement & { reads: FileRead[] })[];
}

/** The names the lifted file reads take; nobody writes a table called this. */
const fileCte = (n: number) => `__puddle_file_${n}`;

/**
 * Read a SQL node's script against its inputs and files, or say why it can't run, naming the statement. Each
 * statement may read the inputs, the tables made before it and the files it names, nothing else.
 */
export function readScript(sql: string, inputs: Pick<SqlInput, 'port' | 'label'>[], files: ScriptFile[]): ReadScript | { problem: string } {
  const split = splitScript(sql);
  if ('problem' in split) return split;
  if (!split.statements.length) return { problem: 'write a query, such as SELECT * FROM input1' };
  const inputNames = inputs.flatMap((i) => sqlInputNames(i, inputs.length)).map((n) => n.toLowerCase());
  const made: string[] = [];
  let n = 0;
  const statements: ReadScript['statements'] = [];
  for (const [i, s] of split.statements.entries()) {
    const which = split.statements.length > 1 ? (s.label ? `in ${s.label}: ` : `in statement ${i + 1}: `) : '';
    if (!s.table && i < split.statements.length - 1) return { problem: `${which}a query in the middle of a script does nothing: make it CREATE TABLE name AS ${s.query.trim().split(/\s+/)[0]} ...` };
    if (s.table && inputNames.includes(s.table)) return { problem: `${s.label} is already the name of an input: give the table another name` };
    if (s.table && made.includes(s.table)) return { problem: `the script creates ${s.label} twice: give each table its own name` };
    if (s.table && s.table.startsWith('__puddle_')) return { problem: `${s.label} is a name Puddle keeps for itself: give the table another name` };
    const lifted = liftFileReads(s.query, files, () => fileCte(++n));
    if ('problem' in lifted) return { problem: which + lifted.problem };
    const problem = customSqlProblem(lifted.query, [...inputNames, ...made, ...lifted.reads.map((r) => r.cte)]);
    if (problem) return { problem: which + problem };
    statements.push({ ...s, query: lifted.query, reads: lifted.reads });
    if (s.table) made.push(s.table);
  }
  return { statements };
}

/**
 * The script as CTEs: one per statement, named by `cteOf(k)`, each binding the inputs, the tables before it and its
 * file reads around its query. The last is the node's rows. Call only on a script readScript accepts.
 */
export function compileScript(script: ReadScript, inputs: SqlInput[], cteOf: (k: number) => string): string[] {
  const bound = inputs.flatMap((i) => sqlInputNames(i, inputs.length).map((name) => `${ident(name)} AS (SELECT * FROM ${i.cte})`));
  return script.statements.map((s, k) => {
    const earlier = script.statements.slice(0, k).flatMap((e, j) => (e.table ? [`${ident(e.table)} AS (SELECT * FROM ${cteOf(j)})`] : []));
    const reads = s.reads.map((r) => `${ident(r.cte)} AS (SELECT * FROM ${r.relation})`);
    const ctes = [...bound, ...earlier, ...reads];
    const body = `${CUSTOM_SQL_OPENER}\n${cleanCustomSql(s.query)}\n)`;
    return `${cteOf(k)} AS (${ctes.length ? `WITH ${ctes.join(', ')}\n` : ''}${body})`;
  });
}
