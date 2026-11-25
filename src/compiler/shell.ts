// The DuckDB shell under the results: commands typed as in DuckDB's own shell, read against the project. Every node
// is a table by its name (and the viewed node is `input` too); a query is answered in the shell, DESCRIBE, SUMMARIZE
// and EXPLAIN describe one, and a statement that makes or changes a table goes into a SQL script so the table is a
// node on the canvas. What the browser can't do (ATTACH a file by its path, COPY to disk, INSTALL) is refused in words
// that say what Puddle does instead. Pure: the console runs what this compiles.
import { compile, type Target } from './compile';
import { cleanCustomSql, customSqlProblem, INPUT_NAME, lexSql, SqlRefusal, sqlTableRefs, type SqlToken } from './customSql';
import { ident } from './sql';
import { splitScript } from './sqlScript';
import { CUSTOM_SQL_OPENER } from './steps/advanced';
import type { Project } from '../model';

/** How many rows a shell answer shows at most; the shell is for looking, a SQL node for keeping. */
export const SHELL_ROW_LIMIT = 200;

/** A statement of a shell command, as Puddle reads it. */
export type ShellStatement =
  /** A query, answered in the shell. */
  | { kind: 'query'; text: string; query: string }
  /** DESCRIBE, SHOW, SUMMARIZE or EXPLAIN of a table or a query: `query` is what it describes. */
  | { kind: 'describe'; text: string; how: 'DESCRIBE' | 'SUMMARIZE' | 'EXPLAIN'; query: string }
  /** SHOW TABLES, or .tables. */
  | { kind: 'tables'; text: string; pattern?: string }
  /** CREATE TABLE, INSERT, UPDATE, DELETE, ALTER TABLE, DROP TABLE: kept in a SQL script. */
  | { kind: 'change'; text: string }
  /** A dot command: .help, .schema, .clear and the like. */
  | { kind: 'dot'; text: string; name: string; arg: string }
  /** Something the shell can't do here, and why. */
  | { kind: 'refused'; text: string; problem: string };

/** The dot commands the shell knows, with what each does, for .help. */
export const DOT_COMMANDS: { name: string; usage: string; does: string }[] = [
  { name: 'tables', usage: '.tables [pattern]', does: 'List the tables of the project: every node, by its name' },
  { name: 'schema', usage: '.schema [table]', does: 'Show CREATE TABLE for a table, or for every table' },
  { name: 'help', usage: '.help', does: 'Show what the shell can do' },
  { name: 'clear', usage: '.clear', does: 'Clear the shell (Ctrl+L does too)' },
];

/** Dot commands of DuckDB's own shell that do something Puddle does another way. */
const OTHER_DOTS: Record<string, string> = {
  open: 'Puddle has one database, the project: add a database file as a source from the Add menu and read its tables by name',
  read: 'type or paste the SQL into the shell, or into a SQL node',
  import: 'add the file as a source from the Add menu, then read it by its name',
  output: 'view the table and use Export, which saves it as a file',
  once: 'view the table and use Export, which saves it as a file',
  mode: 'the shell always shows rows as a table; Export saves them in other formats',
  quit: 'close the shell with the Console button',
  exit: 'close the shell with the Console button',
  shell: 'the browser can’t run programs on your computer',
  system: 'the browser can’t run programs on your computer',
  cd: 'the browser can’t reach your folders: add files as sources from the Add menu',
};

/** Statements DuckDB runs that the browser can't, and what to do instead. */
const REFUSED: Record<string, string> = {
  attach: 'ATTACH opens a database by its path, and the browser can’t reach your disk: add the database file (DuckDB, SQLite or Access) as a source from the Add menu and read its tables by name',
  detach: 'Puddle has one database, the project: remove a source by deleting its node',
  use: 'Puddle has one database, the project: read its tables by name',
  copy: 'COPY writes or reads a file on disk, which the browser can’t reach: add files as sources from the Add menu, and save a table with Export',
  export: 'EXPORT DATABASE writes files on disk: save a table with Export instead',
  import: 'IMPORT DATABASE reads files on disk: add the files as sources from the Add menu',
  install: 'Puddle loads the DuckDB extensions it needs itself',
  load: 'Puddle loads the DuckDB extensions it needs itself',
  force: 'Puddle loads the DuckDB extensions it needs itself',
  set: 'Puddle keeps DuckDB’s settings itself; a project’s number and date formats are under Project settings',
  reset: 'Puddle keeps DuckDB’s settings itself',
  pragma: 'PRAGMA reads or changes DuckDB itself: use .tables, .schema or DESCRIBE to see the project’s tables',
  call: 'CALL runs a DuckDB function on DuckDB itself: use .tables, .schema or DESCRIBE to see the project’s tables',
  checkpoint: 'the project keeps its tables as queries, so there is nothing to write to disk',
  vacuum: 'the project keeps its tables as queries, so there is nothing to tidy',
  analyze: 'the project keeps its tables as queries, so there is nothing to analyse: SUMMARIZE a table to see its statistics',
  begin: 'the shell has no transactions: each command is one step you can undo with Ctrl+Z',
  start: 'the shell has no transactions: each command is one step you can undo with Ctrl+Z',
  commit: 'the shell has no transactions: each command is one step you can undo with Ctrl+Z',
  rollback: 'the shell has no transactions: undo a command with Ctrl+Z',
  abort: 'the shell has no transactions: undo a command with Ctrl+Z',
  end: 'the shell has no transactions: each command is one step you can undo with Ctrl+Z',
  prepare: 'the shell runs each statement as typed: write the values into the query',
  execute: 'the shell runs each statement as typed: write the values into the query',
  deallocate: 'the shell runs each statement as typed',
  comment: 'describe a table on its node: select the node and write in its description',
  merge: 'MERGE INTO needs keys a script’s tables don’t keep: UPDATE, then INSERT the rows that are new',
};

const QUERY_START = new Set(['select', 'with', 'from', 'values', 'table', 'pivot', 'unpivot']);
const CHANGES = new Set(['create', 'insert', 'update', 'delete', 'alter', 'drop']);
const end = (t: SqlToken) => t.start + t.text.length;

/**
 * A shell command split into its statements (at semicolons outside strings and comments), each read as the shell
 * reads it. A dot command is a line of its own. Empty for nothing but spaces and comments.
 */
export function readShellCommand(command: string): ShellStatement[] {
  const trimmed = command.trim();
  if (trimmed.startsWith('.')) {
    const [, name = '', arg = ''] = /^\.(\S*)\s*([\s\S]*)$/.exec(trimmed) ?? [];
    return [readDot(trimmed, name.toLowerCase(), arg.trim().replace(/;$/, '').trim())];
  }
  let tokens: SqlToken[];
  try {
    tokens = lexSql(command);
  } catch (e) {
    if (e instanceof SqlRefusal) return [{ kind: 'refused', text: trimmed, problem: e.message }];
    throw e;
  }
  const chunks: SqlToken[][] = [[]];
  for (const t of tokens) {
    if (t.kind === 'op' && t.text === ';') chunks.push([]);
    else chunks[chunks.length - 1]!.push(t);
  }
  return chunks.flatMap((chunk) => {
    const words = chunk.filter((t) => t.kind !== 'comment');
    if (!words.length) return [];
    const text = command.slice(chunk[0]!.start, end(chunk[chunk.length - 1]!)).trim();
    return [readStatement(command, words, text)];
  });
}

function readDot(text: string, name: string, arg: string): ShellStatement {
  if (name === 'tables') return { kind: 'tables', text, ...(arg ? { pattern: arg } : {}) };
  if (DOT_COMMANDS.some((d) => d.name === name)) return { kind: 'dot', text, name, arg };
  if (OTHER_DOTS[name]) return { kind: 'refused', text, problem: `.${name} isn’t something the shell can do here: ${OTHER_DOTS[name]}` };
  return { kind: 'refused', text, problem: `the shell doesn’t know .${name}: type .help to see what it can do` };
}

function readStatement(sql: string, words: SqlToken[], text: string): ShellStatement {
  const first = words[0]!;
  const rest = (k: number) => (words[k] ? sql.slice(words[k]!.start, end(words[words.length - 1]!)) : '');
  const word = (k: number) => (words[k]?.kind === 'word' ? words[k]!.value : undefined);
  if (first.text === '(' || (first.kind === 'word' && QUERY_START.has(first.value))) return { kind: 'query', text, query: rest(0) };
  if (first.kind !== 'word') return { kind: 'refused', text, problem: `start the statement with a word such as SELECT, not ${first.text}` };
  switch (first.value) {
    case 'describe':
    case 'desc':
    case 'show':
    case 'summarize':
    case 'explain': {
      if (first.value === 'show' && (word(1) === 'tables' || (word(1) === 'all' && word(2) === 'tables'))) return { kind: 'tables', text };
      if (first.value === 'show' && !words[1]) return { kind: 'tables', text };
      const how = first.value === 'summarize' ? 'SUMMARIZE' : first.value === 'explain' ? 'EXPLAIN' : 'DESCRIBE';
      let k = 1;
      if (how === 'EXPLAIN' && word(1) === 'analyze') k = 2;
      if (how === 'DESCRIBE' && word(1) === 'table') k = 2;
      if (!words[k]) return { kind: 'refused', text, problem: `say what to ${how.toLowerCase()}: ${how} name, or ${how} SELECT ...` };
      const target = words[k]!;
      // A table by its name alone: the name, with nothing after it.
      if ((target.kind === 'word' || target.kind === 'quoted') && k === words.length - 1 && !QUERY_START.has(target.value)) return { kind: 'describe', text, how, query: `SELECT * FROM ${target.text}` };
      if (target.kind === 'string' && k === words.length - 1) return { kind: 'describe', text, how, query: `FROM ${target.text}` };
      if (how === 'EXPLAIN' && word(k) && CHANGES.has(word(k)!)) return { kind: 'refused', text, problem: 'EXPLAIN shows how DuckDB runs a query: run the change itself, and EXPLAIN SELECT * FROM the table after it' };
      return { kind: 'describe', text, how, query: rest(k) };
    }
    default:
      if (CHANGES.has(first.value)) return { kind: 'change', text };
      if (REFUSED[first.value]) return { kind: 'refused', text, problem: `${first.text.toUpperCase()} isn’t something the shell can do here: ${REFUSED[first.value]}` };
      return { kind: 'refused', text, problem: `the shell doesn’t know ${first.text.toUpperCase()}: type .help to see what it can do` };
  }
}

/** The tables the shell reads by name: each node whose name no other node has, and the viewed node as `input`. */
export function shellNames(project: Project, viewedId?: string): Map<string, string> {
  const counts = new Map<string, number>();
  for (const n of project.nodes) counts.set(n.name.toLowerCase(), (counts.get(n.name.toLowerCase()) ?? 0) + 1);
  const names = new Map<string, string>();
  for (const n of project.nodes) if (counts.get(n.name.toLowerCase()) === 1 && n.name.toLowerCase() !== INPUT_NAME) names.set(n.name.toLowerCase(), n.id);
  if (viewedId && project.nodes.some((n) => n.id === viewedId)) names.set(INPUT_NAME, viewedId);
  return names;
}

/**
 * Why a statement can't run, in words that say what to change, or undefined. A query (and what DESCRIBE describes) may
 * read the tables by name; a change is checked as far as reading it goes, and by the script it joins when it runs.
 */
export function shellProblem(statement: ShellStatement, names: ReadonlyMap<string, string>): string | undefined {
  switch (statement.kind) {
    case 'refused':
      return statement.problem;
    case 'query':
    case 'describe':
      return customSqlProblem(statement.query, [...names.keys()]);
    case 'change': {
      const split = splitScript(statement.text);
      return 'problem' in split ? split.problem : undefined;
    }
    default:
      return undefined;
  }
}

/** The first problem of a command's statements, or undefined when every one can run. */
export function shellCommandProblem(command: string, names: ReadonlyMap<string, string>): string | undefined {
  const statements = readShellCommand(command);
  if (!statements.length) return `write a query, such as SELECT * FROM ${names.has(INPUT_NAME) ? INPUT_NAME : (names.keys().next().value ?? 'a_table')}`;
  for (const s of statements) {
    const problem = shellProblem(s, names);
    if (problem) return problem;
  }
  return undefined;
}

/**
 * A query against the project's tables: each table it names by its node's name (or `input`) bound to that node's SQL,
 * the query as written in the middle, cut to `limit` rows when one is given. Call only on a query shellProblem accepts.
 */
export function compileShellQuery(project: Project, names: ReadonlyMap<string, string>, query: string, limit?: number): string {
  const problem = customSqlProblem(query, [...names.keys()]);
  if (problem) throw new Error(`This query can’t run: ${problem}.`);
  const read = [...new Set(sqlTableRefs(query, [...names.keys()]).filter((r) => r.known).map((r) => r.name))];
  const ctes = read.map((name) => `${ident(name)} AS (\n${compile(project, { nodeId: names.get(name)! } satisfies Target).sql}\n)`);
  const body = `${CUSTOM_SQL_OPENER}\n${cleanCustomSql(query)}\n)`;
  return `${ctes.length ? `WITH ${ctes.join(',\n')}\n` : ''}${body}${limit != null ? ` LIMIT ${limit}` : ''}`;
}

/** DESCRIBE, SUMMARIZE or EXPLAIN of what a describe statement names, over the project's tables. */
export function compileShellDescribe(project: Project, names: ReadonlyMap<string, string>, statement: Extract<ShellStatement, { kind: 'describe' }>): string {
  return `${statement.how} ${compileShellQuery(project, names, statement.query)}`;
}

/** The first rows of one node, for the shell to show a table it made or changed. */
export function compileShellPreview(project: Project, nodeId: string, limit = SHELL_ROW_LIMIT): string {
  return `${CUSTOM_SQL_OPENER}\n${compile(project, { nodeId }).sql}\n) LIMIT ${limit}`;
}

/** How many rows one node has, as `n`. */
export function compileShellCount(project: Project, nodeId: string): string {
  return `SELECT count(*) AS n FROM (\n${compile(project, { nodeId }).sql}\n)`;
}

/** All of one table the shell reads by name, for reading its columns. */
export function compileShellTable(project: Project, names: ReadonlyMap<string, string>, name: string): string {
  return compileShellQuery(project, names, `SELECT * FROM ${ident(name)}`);
}

/** A table's columns as DuckDB's shell writes .schema: CREATE TABLE name(column TYPE, ...); */
export function schemaStatement(table: string, columns: { name: string; type: string }[]): string {
  const name = /^[A-Za-z_][A-Za-z0-9_]*$/.test(table) ? table : ident(table);
  const col = (c: { name: string; type: string }) => `${/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name) ? c.name : ident(c.name)} ${c.type}`;
  return `CREATE TABLE ${name}(${columns.map(col).join(', ')});`;
}

/** Does a table's name match a .tables pattern? DuckDB's shell takes a LIKE pattern: % any run, _ one character. */
export function likePattern(pattern: string, name: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
  return re.test(name);
}
