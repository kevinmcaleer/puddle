// SQL scripts in a SQL node: CREATE TABLE name AS ... statements, each a table the statements after it can read,
// then optionally a last query; and the files of wired file sources, read by name (read_parquet('*.parquet')).
//
// A script never runs as statements. Each table becomes a CTE, so the script stays one SELECT the compiler can
// chain, cache and stop like any other node, and nothing it does outlives the query. A file read is lifted out of
// the query into a CTE of its own that reads exactly the wired files its name or pattern matches; what remains is
// checked by customSqlProblem like any SQL node's query, so the script still can't reach anything else.
import { cleanCustomSql, customSqlProblem, lexSql, SqlRefusal, sqlTableRefs, type SqlToken } from './customSql';
import { globMatches, isGlob } from './fileSet';
import { sqlInputNames, type SqlInput } from './sqlNode';
import { ident, strList } from './sql';
import { CUSTOM_SQL_OPENER } from './steps/advanced';
import { readChange, type ChangedName, type ChangeKind, type WrittenPiece } from './scriptChanges';

/** A file a SQL node may read by name: its name as chosen, and the name DuckDB has it registered under. */
export interface ScriptFile {
  name: string;
  registered: string;
}

/**
 * One statement of a script: the table it creates (none for a last query) and its query, as written. A statement that
 * changes a table made before it (INSERT, UPDATE, DELETE, ALTER TABLE) makes a new version of that table, its query
 * the table's rows after the change; DROP TABLE has no query and `drops` the table.
 */
export interface ScriptStatement {
  table?: string;
  /** The table's name as written, for messages. */
  label?: string;
  query: string;
  /** What the statement does, when it isn't CREATE TABLE name AS a query (or a query). */
  change?: ChangeKind;
  /** The table the statement takes away: DROP TABLE's, or the old name of ALTER TABLE ... RENAME TO. */
  drops?: string;
}

/** The words a query starts with, for telling a query written straight after a table's name from anything else. */
const QUERY_WORDS = new Set(['select', 'with', 'from', 'values']);

const end = (t: SqlToken) => t.start + t.text.length;
const isName = (t: SqlToken | undefined): t is SqlToken => !!t && (t.kind === 'word' || t.kind === 'quoted');

/**
 * The statements of a query split at its semicolons (comments and strings respected), each read as CREATE [OR REPLACE]
 * TABLE name AS query, or as a query. Returns a reason when the text can't be read that way.
 */
export function splitScript(sql: string): { statements: ScriptStatement[] } | { problem: string } {
  const split = splitPlaced(sql);
  return 'problem' in split ? split : { statements: split.statements.map(unplaced) };
}

/**
 * A statement with where it sits in the script: its query's offset, the span of the table name it creates, the names
 * it acts on and the pieces of what was written it reads as SQL (its query, or a change's values and conditions).
 */
type PlacedStatement = ScriptStatement & {
  at: number;
  name?: [start: number, end: number];
  names: ChangedName[];
  pieces: WrittenPiece[];
  /** CREATE OR REPLACE: may make a table the script made before. */
  replace?: boolean;
  /** The table a change acts on (as written), which the script must have made before it. */
  target?: ChangedName;
  /** DROP TABLE IF EXISTS. */
  ifExists?: boolean;
};

const unplaced = ({ at: _at, name: _name, names: _names, pieces: _pieces, replace: _replace, target: _target, ifExists: _ifExists, ...s }: PlacedStatement): ScriptStatement => s;

function splitPlaced(sql: string): { statements: PlacedStatement[] } | { problem: string } {
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
  const statements: PlacedStatement[] = [];
  for (const chunk of chunks) {
    const words = chunk.filter((t) => t.kind !== 'comment');
    if (!words.length) continue;
    const from = words[0]!.start;
    const to = end(words[words.length - 1]!);
    const change = readChange(words, sql);
    if (change && 'problem' in change) return change;
    if (change) {
      const { table, target, query, pieces } = change;
      statements.push({
        ...(table ? { table: table.table, label: table.label } : {}),
        query,
        change: change.change,
        ...(change.change === 'drop' || change.change === 'rename' ? { drops: target!.table } : {}),
        at: from,
        ...(table?.makes ? { name: table.span } : {}),
        names: [...(target ? [target] : []), ...(table && table !== target && table.span[0] !== target?.span[0] ? [table] : [])],
        pieces,
        ...(change.change !== 'declare' ? { target } : {}),
        ...(change.ifExists ? { ifExists: true } : {}),
        replace: /^\s*create\s+or\s+replace\b/i.test(sql.slice(from, to)),
      });
      continue;
    }
    if (words[0]!.value !== 'create' || words[0]!.kind !== 'word') {
      statements.push({ query: sql.slice(from, to), at: from, names: [], pieces: [{ at: from, text: sql.slice(from, to) }] });
      continue;
    }
    // CREATE [OR REPLACE] [TEMP | TEMPORARY] TABLE | VIEW [IF NOT EXISTS] name AS query
    let k = 1;
    const word = (v: string) => words[k]?.kind === 'word' && words[k]!.value === v;
    const replace = word('or') && words[k + 1]?.value === 'replace';
    if (replace) k += 2;
    if (word('temp') || word('temporary')) k++;
    if (!word('table') && !word('view')) return { problem: `${shown(words, 0, k + 1)} isn’t something a script can do: it can only CREATE TABLE name AS a query` };
    k++;
    if (word('if') && words[k + 1]?.value === 'not' && words[k + 2]?.value === 'exists') k += 3;
    const name = words[k];
    if (!isName(name)) return { problem: 'name the table: CREATE TABLE name AS SELECT ...' };
    // CREATE TABLE AS users SELECT ...: AS is a reserved word, never the table; the name comes before it.
    if (name.kind === 'word' && name.value === 'as') {
      const next = words[k + 1];
      if (!isName(next) || (next.kind === 'word' && QUERY_WORDS.has(next.value))) return { problem: `name the table before AS: ${shown(words, 0, k)} name AS SELECT ...` };
      const query = words[k + 2];
      return { problem: `put the table’s name before AS: ${shown(words, 0, k)} ${next.text} AS ${query?.kind === 'word' && QUERY_WORDS.has(query.value) ? query.text : 'SELECT'} ...` };
    }
    if (words[k + 1]?.text === '.') return { problem: `create ${name.text} without a schema or database: CREATE TABLE ${words[k + 2]?.text ?? 'name'} AS SELECT ...` };
    const as = words[k + 1];
    // CREATE TABLE users SELECT ...: the query is there, only the AS before it is missing.
    if (as?.kind === 'word' && QUERY_WORDS.has(as.value)) return { problem: `put AS between ${name.text} and its query: ${shown(words, 0, k)} ${name.text} AS ${as.text} ...` };
    if (!as || as.kind !== 'word' || as.value !== 'as') return { problem: `give ${name.text} its rows with AS and a query: CREATE TABLE ${name.text} AS SELECT ... or declare its columns: CREATE TABLE ${name.text} (id INTEGER, name VARCHAR)` };
    if (!words[k + 2]) return { problem: `write the query ${name.text} is made from after AS` };
    // CREATE TABLE name AS (SELECT ...): the brackets around the whole query say nothing, so they go.
    const body = wrapped(words, k + 2) ? words.slice(k + 3, -1) : words.slice(k + 2);
    if (!body.length) return { problem: `write the query ${name.text} is made from after AS` };
    const label = name.kind === 'quoted' ? name.text.slice(1, -1).replace(/""/g, '"') : name.text;
    const query = sql.slice(body[0]!.start, end(body[body.length - 1]!));
    statements.push({
      table: name.value,
      label,
      query,
      at: body[0]!.start,
      name: [name.start, end(name)],
      names: [{ span: [name.start, end(name)], table: name.value, label, makes: true }],
      pieces: [{ at: body[0]!.start, text: query }],
      ...(replace ? { replace } : {}),
    });
  }
  return { statements };
}

/**
 * The line of SQL written on a node (a query or a script) that a DuckDB error points at ("LINE 48: ..."), given the
 * compiled SQL that failed. DuckDB counts the lines of everything sent to it; each statement's query is found there, and
 * has its own place in what was written. A statement whose text was changed on the
 * way (a file read lifted out of it) is found by the text DuckDB quotes, when one line alone holds it.
 */
export function writtenSqlErrorLine(compiledSql: string, sql: string, error: string): { line: number; text: string } | undefined {
  const at = /LINE (\d+):[ \t]?(.*)/.exec(error);
  const split = splitPlaced(sql);
  if (!at || 'problem' in split) return undefined;
  const lines = sql.split('\n');
  const found = (line: number) => (line >= 1 && line <= lines.length ? { line, text: lines[line - 1]!.trim() } : undefined);
  const failed = Number(at[1]);
  for (const s of split.statements) {
    const cleaned = cleanCustomSql(s.query);
    const body = `${cleaned}\n)`;
    const count = cleaned.split('\n').length;
    for (let pos = compiledSql.indexOf(body); pos >= 0; pos = compiledSql.indexOf(body, pos + 1)) {
      const within = failed - compiledSql.slice(0, pos).split('\n').length + 1;
      if (within >= 1 && within <= count) return found(sql.slice(0, s.at).split('\n').length + within - 1);
    }
  }
  // DuckDB quotes the line, cut short with "..." at either end when it is long.
  const quoted = at[2]!.replace(/^\.\.\./, '').replace(/\.\.\.$/, '').trim();
  if (!quoted) return undefined;
  const holding = lines.flatMap((l, i) => (l.includes(quoted) ? [i + 1] : []));
  return holding.length === 1 ? found(holding[0]!) : undefined;
}

/** True when the bracket opening at `from` closes on the last token, so it wraps everything from there on. */
function wrapped(tokens: SqlToken[], from: number): boolean {
  if (tokens[from]?.kind !== 'op' || tokens[from]!.text !== '(') return false;
  let depth = 0;
  for (let i = from; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== 'op') continue;
    if (t.text === '(') depth++;
    else if (t.text === ')' && --depth === 0) return i === tokens.length - 1;
  }
  return false;
}

const shown = (tokens: SqlToken[], from: number, to: number) => tokens.slice(from, to).map((t) => t.text.toUpperCase()).join(' ');

/** True when a SQL node's query is a script: more than one statement, or a CREATE TABLE. */
export function isScript(sql: string): boolean {
  const split = splitScript(sql);
  return 'problem' in split
    ? /^\s*(create|insert|update|delete|alter|drop)\b/i.test(sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '')) || /;\s*\S/.test(sql)
    : split.statements.length > 1 || split.statements.some((s) => s.table || s.change);
}

/**
 * The tables a script leaves, in the order they were first made, as written. A table dropped (or renamed) isn't one;
 * one changed is still the one table. Empty for a single query, or a script that can't be read.
 */
export function scriptTables(sql: string): string[] {
  const split = splitScript(sql);
  if ('problem' in split) return [];
  const tables: string[] = [];
  for (const s of split.statements) {
    if (s.drops) {
      const at = tables.findIndex((t) => t.toLowerCase() === s.drops);
      if (at >= 0 && !(s.change === 'rename' && s.table)) tables.splice(at, 1);
      // Renamed: the table keeps its place under its new name.
      else if (at >= 0 && s.label) tables[at] = s.label;
      continue;
    }
    if (s.label && !tables.some((t) => t.toLowerCase() === s.table)) tables.push(s.label);
  }
  return tables;
}

/** A table named in a script, for an editor to mark: an input, a table the script makes, or one that isn't there. */
export interface ScriptTableRef {
  start: number;
  end: number;
  /** The name in lower case. */
  name: string;
  kind: 'input' | 'made' | 'unknown';
}

/**
 * Every table a query or script names where it reads or creates one, in order: `names` are the names its inputs may
 * be read by. A table is `made` where the script creates it and wherever a later statement reads it. Empty while the
 * text can't be split into statements.
 */
export function scriptTableRefs(sql: string, names: readonly string[]): ScriptTableRef[] {
  const split = splitPlaced(sql);
  if ('problem' in split) return [];
  const inputs = names.map((n) => n.toLowerCase());
  const made = new Set<string>();
  const out: ScriptTableRef[] = [];
  for (const s of split.statements) {
    for (const n of s.names) out.push({ start: n.span[0], end: n.span[1], name: n.table, kind: n.makes || made.has(n.table) ? 'made' : 'unknown' });
    for (const piece of s.pieces) {
      let refs: ReturnType<typeof sqlTableRefs> = [];
      try {
        // A value or condition is read as the query that selects it, so its subqueries' tables are found.
        refs = piece.expr ? sqlTableRefs(`SELECT ${piece.text}`, [...inputs, ...made]).map((r) => ({ ...r, start: r.start - 7, end: r.end - 7 })) : sqlTableRefs(piece.text, [...inputs, ...made]);
      } catch {
        // Text the lexer won't guess about: nothing to mark in this piece.
      }
      for (const r of refs) out.push({ start: piece.at + r.start, end: piece.at + r.end, name: r.name, kind: !r.known ? 'unknown' : made.has(r.name) ? 'made' : 'input' });
    }
    if (s.drops) made.delete(s.drops);
    if (s.table) made.add(s.table);
  }
  return out.sort((a, b) => a.start - b.start);
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
/**
 * The table names a query or script reads that it does not create itself, in lower case and in order, each once: the
 * inputs (input1, a node's name) and any other name, which may be a table of the project to wire in by name.
 */
export function sqlReads(sql: string): string[] {
  const names = scriptTableRefs(sql, []).filter((r) => r.kind === 'unknown').map((r) => r.name);
  return names.filter((n, i) => names.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i);
}

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
  return readScriptOver(sql, inputs.flatMap((i) => sqlInputNames(i, inputs.length)), files);
}

/** readScript for any node that runs SQL as written: `names` are the names its inputs may be read by. */
export function readScriptOver(sql: string, names: readonly string[], files: ScriptFile[]): ReadScript | { problem: string } {
  const split = splitPlaced(sql);
  if ('problem' in split) return split;
  if (!split.statements.length) return { problem: `write a query, such as SELECT * FROM ${names[0] ?? 'input1'}` };
  const inputNames = names.map((n) => n.toLowerCase());
  // The tables made so far, each by its name in lower case to its name as written.
  const made = new Map<string, string>();
  let n = 0;
  const statements: ReadScript['statements'] = [];
  for (const [i, s] of split.statements.entries()) {
    const which = split.statements.length > 1 ? (s.label ? `in ${s.label}: ` : s.target ? `in ${s.target.label}: ` : `in statement ${i + 1}: `) : '';
    if (!s.table && !s.change && i < split.statements.length - 1) return { problem: `${which}a query in the middle of a script does nothing: make it CREATE TABLE name AS ${s.query.trim().split(/\s+/)[0]} ...` };
    if (s.target && !made.has(s.target.table)) {
      if (s.ifExists) continue;
      const what = s.change === 'drop' ? 'drop' : 'change';
      if (inputNames.includes(s.target.table)) return { problem: `${which}${s.target.label} is a table this node reads, which a script can’t ${what}: make a table of your own from it first, CREATE TABLE my_${s.target.table.replace(/\W+/g, '_')} AS SELECT * FROM ${s.target.label}` };
      return { problem: `${which}there’s no table ${s.target.label} to ${what}: the script makes it first with CREATE TABLE ${s.target.label} AS ...` };
    }
    const makes = s.table && (!s.change || s.change === 'declare' || s.change === 'rename');
    if (makes && inputNames.includes(s.table!)) return { problem: `${s.label} is already the name of an input: give the table another name` };
    if (makes && made.has(s.table!) && !s.replace) return { problem: s.change === 'rename' ? `${which}there’s already a table ${s.label}: rename it to another name` : `the script creates ${s.label} twice: write CREATE OR REPLACE TABLE ${s.label} to make it again, or give each table its own name` };
    if (makes && s.table!.startsWith('__puddle_')) return { problem: `${s.label} is a name Puddle keeps for itself: give the table another name` };
    const at = (statement: ScriptStatement) => {
      const { at: _a, name: _n, names: _ns, pieces: _p, replace: _r, target: _t, ifExists: _e, ...rest } = statement as PlacedStatement;
      return rest;
    };
    if (s.change === 'drop') {
      made.delete(s.drops!);
      statements.push({ ...at(s), reads: [] });
      continue;
    }
    const lifted = liftFileReads(s.query, files, () => fileCte(++n));
    if ('problem' in lifted) return { problem: which + lifted.problem };
    const problem = customSqlProblem(lifted.query, [...inputNames, ...made.keys(), ...lifted.reads.map((r) => r.cte)]);
    if (problem) return { problem: which + problem };
    statements.push({ ...at(s), query: lifted.query, reads: lifted.reads });
    if (s.drops) made.delete(s.drops);
    if (s.table) made.set(s.table, s.label ?? s.table);
  }
  if (!statements.some((s) => s.change !== 'drop')) return { problem: `write a query, such as SELECT * FROM ${names[0] ?? 'input1'}` };
  return { statements };
}

/**
 * The statement whose rows are the script's: the last one, or where the script ends by dropping tables, the last
 * statement left whose table it didn't drop.
 */
export function scriptRowsIndex(script: ReadScript): number {
  const dropped = new Set<string>();
  for (let k = script.statements.length - 1; k >= 0; k--) {
    const s = script.statements[k]!;
    if (s.drops && s.change === 'drop') dropped.add(s.drops);
    else if (!s.table || !dropped.has(s.table)) return k;
  }
  return script.statements.length - 1;
}

/** The CTE (by `cteOf`) that holds each table the script leaves, by its name in lower case. */
export function scriptTableCtes(script: ReadScript, cteOf: (k: number) => string): Map<string, string> {
  const made = new Map<string, string>();
  script.statements.forEach((st, k) => {
    if (st.drops) made.delete(st.drops);
    if (st.table) made.set(st.table, cteOf(k));
  });
  return made;
}

/**
 * The script as CTEs: one per statement, named by `cteOf(k)`, each binding the inputs, the tables before it and its
 * file reads around its query. The last is the node's rows. Call only on a script readScript accepts.
 */
export function compileScript(script: ReadScript, inputs: SqlInput[], cteOf: (k: number) => string): string[] {
  return compileScriptOver(script, inputs.flatMap((i) => sqlInputNames(i, inputs.length).map((name) => ({ name, cte: i.cte }))), cteOf);
}

/** One name an input may be read by, and the CTE holding that input's rows. */
export interface ScriptBinding {
  name: string;
  cte: string;
}

/** compileScript for a script read by readScriptOver: `bindings` give each of its names the CTE it reads. */
export function compileScriptOver(script: ReadScript, bindings: ScriptBinding[], cteOf: (k: number) => string): string[] {
  const bound = bindings.map((b) => `${ident(b.name)} AS (SELECT * FROM ${b.cte})`);
  return script.statements.flatMap((s, k) => {
    // A DROP TABLE makes no rows: the tables after it just can't read the one it drops.
    if (s.change === 'drop') return [];
    // Each table made before, at its latest version: a change reads the version before it.
    const earlier = [...scriptTableCtes({ statements: script.statements.slice(0, k) }, cteOf)].map(([table, cte]) => `${ident(table)} AS (SELECT * FROM ${cte})`);
    const reads = s.reads.map((r) => `${ident(r.cte)} AS (SELECT * FROM ${r.relation})`);
    const ctes = [...bound, ...earlier, ...reads];
    const body = `${CUSTOM_SQL_OPENER}\n${cleanCustomSql(s.query)}\n)`;
    return `${cteOf(k)} AS (${ctes.length ? `WITH ${ctes.join(', ')}\n` : ''}${body})`;
  });
}
