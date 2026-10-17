// Checks for the custom SQL step: the user's query may read its own input and nothing else.
//
// Four things keep a step to its input:
// - The query is lexed here the way DuckDB lexes it, and engine tests compare the two on every accepted query.
//   What the lexer can't be sure of (escape strings, dollar quoting, a quote glued to a word) is refused, not guessed.
// - Comments are dropped before the query reaches DuckDB, so nothing can hide in them, and brackets must balance.
// - The compiler runs the query as a subquery, where only queries are legal: no COPY, ATTACH, SET and the like.
// - Every table the query reads must be `input` or a CTE it defined earlier, and the only table functions are
//   ones that make rows from their arguments. A list of file and SQL readers is refused anywhere, as a second line.

export type SqlTokenKind = 'word' | 'quoted' | 'string' | 'number' | 'op' | 'comment';

export interface SqlToken {
  kind: SqlTokenKind;
  /** The token's text as written. */
  text: string;
  /** Offset of its first character in the query. */
  start: number;
  /** Words and quoted names in lower case (DuckDB names ignore case, quoted or not); a string's content; otherwise the text. */
  value: string;
}

/** Thrown by the lexer for text it won't guess about. */
export class SqlRefusal extends Error {}

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
// Outside quotes, only ASCII: DuckDB turns Unicode spaces into plain ones before parsing, so a no-break space
// that looks like part of a name to a lexer is a word break to DuckDB.
const isWordStart = (c: string) => /[A-Za-z_]/.test(c);
const isWordPart = (c: string) => /[A-Za-z0-9_]/.test(c);

/** Split a query into tokens, comments included. Throws SqlRefusal with a reason for anything ambiguous. */
export function lexSql(sql: string): SqlToken[] {
  const out: SqlToken[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const start = i;
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n' && sql[i] !== '\r') i++;
      out.push({ kind: 'comment', text: sql.slice(start, i), start, value: '' });
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      // Block comments nest, as in Postgres. Either way the comment never reaches DuckDB.
      let depth = 0;
      while (i < sql.length) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else i++;
      }
      if (depth !== 0) throw new SqlRefusal('close the /* comment with */');
      out.push({ kind: 'comment', text: sql.slice(start, i), start, value: '' });
      continue;
    }
    if (c === "'" || c === '"') {
      // A quote glued to a word, & or $ is a prefixed literal (E'..', U&'..', X'..'), and E'..' ends differently.
      const before = sql[i - 1];
      if (before != null && (isWordPart(before) || before === '&' || before === '$' || before === '\\')) throw new SqlRefusal(`put a space before ${c}: prefixed strings like E'...' aren’t supported`);
      i++;
      let value = '';
      for (;;) {
        if (i >= sql.length) throw new SqlRefusal(c === "'" ? "close the ' string" : 'close the " name');
        if (sql[i] === c) {
          if (sql[i + 1] === c) {
            value += c;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += sql[i];
        i++;
      }
      out.push({ kind: c === "'" ? 'string' : 'quoted', text: sql.slice(start, i), start, value: c === '"' ? value.toLowerCase() : value });
      continue;
    }
    if (c.charCodeAt(0) >= 0x80) throw new SqlRefusal(`write names with ${c.trim() ? c : 'that space'} in double quotes: outside quotes, use only plain spaces and ASCII letters`);
    if (c === '$') throw new SqlRefusal("use '...' for text: $ quoting and parameters aren’t supported");
    if (c === '\\') throw new SqlRefusal('a \\ outside a string isn’t SQL');
    if (isWordStart(c)) {
      while (i < sql.length && isWordPart(sql[i]!)) i++;
      const text = sql.slice(start, i);
      out.push({ kind: 'word', text, start, value: text.toLowerCase() });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      while (i < sql.length && /[0-9A-Za-z_.]/.test(sql[i]!)) {
        // 1e-5 and 1e+5 carry their sign.
        if (/[eE]/.test(sql[i]!) && /[+-]/.test(sql[i + 1] ?? '') && /[0-9]/.test(sql[i + 2] ?? '')) i += 2;
        else i++;
      }
      out.push({ kind: 'number', text: sql.slice(start, i), start, value: sql.slice(start, i) });
      continue;
    }
    i++;
    out.push({ kind: 'op', text: c, start, value: c });
  }
  return out;
}

/** Statements that do something other than read the input, named in the refusal when a query starts with one. */
const STATEMENTS = new Set([
  'abort', 'alter', 'analyze', 'attach', 'begin', 'call', 'checkpoint', 'comment', 'commit', 'copy', 'create', 'deallocate', 'delete', 'describe', 'detach', 'drop',
  'end', 'execute', 'explain', 'export', 'force', 'import', 'insert', 'install', 'load', 'merge', 'pragma', 'prepare', 'reset', 'rollback', 'set', 'show',
  'start', 'summarize', 'truncate', 'uninstall', 'update', 'use', 'vacuum',
]);
/** Statements DuckDB allows inside a subquery that read tables or files by name. Refused there too. */
const INNER_STATEMENTS = new Set(['describe', 'show', 'summarize', 'explain', 'call', 'pragma']);
/** Statements that touch files or the database, refused wherever they appear unquoted, as a second line. */
const ANYWHERE = new Set(['attach', 'copy', 'detach', 'export', 'import', 'install', 'load', 'pragma']);
/** What a query may start with. */
const QUERY_STARTS = new Set(['select', 'with', 'from', 'values', 'table', 'pivot', 'unpivot', 'pivot_wider', 'pivot_longer']);
/** Statements that are followed by the table they read. */
const READS_TABLE = new Set(['table', 'pivot', 'unpivot', 'pivot_wider', 'pivot_longer']);
/** Table functions that make rows from their arguments alone. */
const TABLE_FUNCTIONS = new Set(['range', 'generate_series', 'unnest']);
/** Functions that read files, run SQL or reach into the database, refused anywhere they're called. */
const READERS = /^(read_|sniff_|parquet_|iceberg_|delta_|sqlite_|postgres_|mysql_|duckdb_|pragma_|arrow_|json_execute|ducklake_|st_read)|_scan$|_attach$|^(glob|query|query_table|load_aws_credentials|checkpoint|force_checkpoint)$/;
/** Functions whose arguments use FROM as a word: extract(year FROM d), substring(s FROM 2), trim(both FROM s). */
const FROM_IN_ARGUMENTS = new Set(['extract', 'substring', 'trim', 'overlay']);
/** Words that end a FROM list at the same level, so a later comma isn't another table. */
const FROM_LIST_ENDS = new Set(['where', 'group', 'having', 'qualify', 'window', 'order', 'limit', 'offset', 'union', 'intersect', 'except', 'select', 'returning', 'fetch']);
/** Words that take a parenthesised list or subquery rather than naming a function. */
const NOT_CALLS = new Set(['in', 'exists', 'as', 'any', 'all', 'some', 'lateral', 'from', 'join', 'on', 'using', 'over', 'filter', 'within', 'values', 'materialized', 'and', 'or', 'not', 'when', 'then', 'else', 'select', 'where', 'by', 'having', 'union', 'intersect', 'except']);
const SET_OPERATIONS = new Set(['union', 'intersect', 'except']);

// Without IN, DuckDB looks the values up in a separate query, which can't see the step's input.
const PIVOT_VALUES = 'list the values PIVOT turns into columns: PIVOT input ON region IN (\'north\', \'south\') USING sum(total)';

/** The name the input is read by in a custom SQL step. */
export const INPUT_NAME = 'input';

interface Level {
  /** The function this paren holds the arguments of, if it's a call. */
  call?: string;
  /** Inside FROM ... at this level: a comma starts another table. */
  fromList: boolean;
  /** The CTE whose body this paren is, named once it closes. */
  defines?: string;
  /** CTEs defined at this level, visible from here in. */
  ctes: Set<string>;
  /** In a WITH list at this level, waiting for a CTE name. */
  withList: boolean;
}

const level = (patch: Partial<Level> = {}): Level => ({ fromList: false, ctes: new Set(), withList: false, ...patch });
const shown = (t: SqlToken) => t.text;
const isName = (t: SqlToken | undefined) => !!t && (t.kind === 'word' || t.kind === 'quoted');

/**
 * Why a custom SQL query can't run as a step, in words that say what to change, or undefined if it can.
 * Pure and synchronous, so the form shows it as you type and the compiler refuses before anything runs.
 * `tables` are the names the query may read (lower case, as DuckDB compares them): a step's `input`, or a SQL
 * node's inputs.
 */
export function customSqlProblem(sql: string, tables: readonly string[] = [INPUT_NAME]): string | undefined {
  const allowed = new Set(tables.map((t) => t.toLowerCase()));
  // How the refusals name what may be read: "input", or "input1, input2 or their node names".
  const readable = tables.length === 1 ? tables[0]! : 'one of its inputs';
  let tokens: SqlToken[];
  try {
    tokens = lexSql(sql).filter((t) => t.kind !== 'comment');
  } catch (e) {
    if (e instanceof SqlRefusal) return e.message;
    throw e;
  }
  while (tokens.length && tokens[tokens.length - 1]!.text === ';') tokens.pop();
  if (!tokens.length) return `write a query, such as SELECT * FROM ${tables[0] ?? INPUT_NAME}`;
  if (tokens.some((t) => t.text === ';' && t.kind === 'op')) return 'write one query: a ; may only end it';

  const first = tokens[0]!;
  if (first.kind !== 'word' || !QUERY_STARTS.has(first.value)) {
    if (first.kind === 'word' && STATEMENTS.has(first.value)) return `${first.text.toUpperCase()} isn’t allowed: a step can only read its input with SELECT`;
    return `start with SELECT, WITH or FROM: a step is one query over ${readable}`;
  }

  const levels: Level[] = [level()];
  const closers: string[] = [];
  const visible = (name: string) => allowed.has(name) || levels.some((l) => l.ctes.has(name));
  // The next token is a table: after FROM, JOIN, LATERAL, a comma in a FROM list, or TABLE and PIVOT at a statement start.
  let expectTable = false;
  // The next token starts a query: the first, after (, after UNION and friends, after a WITH list.
  let statementStart = true;
  // A CTE named in a WITH list, waiting for AS ( body ).
  let pendingCte: string | undefined;
  // A PIVOT statement, until it names the values its ON column turns into columns.
  let pivot: { level: number; values: boolean } | undefined;

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]!;
    const prev = tokens[k - 1];
    const next = tokens[k + 1];
    const here = levels[levels.length - 1]!;
    const word = t.kind === 'word' ? t.value : undefined;
    const name = isName(t) ? t.value : undefined;
    const isCall = name != null && next?.text === '(';
    const wasExpecting = expectTable;
    const atStart = statementStart;
    expectTable = false;
    statementStart = false;

    if (word && ANYWHERE.has(word)) return `${word.toUpperCase()} isn’t allowed: a step can only read its input. If it’s a column, write it in double quotes, as "${t.text}"`;
    if (atStart && word && (STATEMENTS.has(word) || INNER_STATEMENTS.has(word)) && !QUERY_STARTS.has(word)) {
      if (k > 0 && !INNER_STATEMENTS.has(word) && prev?.text === '(') {
        // A function's first argument named like a statement, such as sum(start): not a statement.
      } else return `${word.toUpperCase()} isn’t allowed: a step can only read its input with SELECT`;
    }
    if (isCall && READERS.test(name)) return `calling ${t.text}() isn’t allowed: a step can only read its input, not files or other tables`;

    if (wasExpecting) {
      if (word === 'lateral') {
        expectTable = true;
        continue;
      }
      if (t.kind === 'string') return `FROM ${t.text} isn’t allowed: a step can only read its input, not files`;
      if (name != null) {
        if (next?.text === '.') return `reading ${shown(t)}.${tokens[k + 2]?.text ?? ''} isn’t allowed: a step can only read ${readable} or the CTEs it defines`;
        if (isCall) {
          if (!TABLE_FUNCTIONS.has(name)) return `calling ${t.text}() after FROM isn’t allowed: a step can only read ${readable}, or rows from range, generate_series or unnest`;
        } else if (!visible(name)) {
          return `there’s no table ${shown(t)} for this step to read: use ${tables.length === 1 ? tables[0] : tables.join(', ')}, or a CTE defined before it`;
        }
      } else if (t.text !== '(') {
        return `put ${readable}, a CTE or a subquery after FROM`;
      }
    }

    if (t.text === '(' || t.text === '[' || t.text === '{') {
      closers.push(t.text === '(' ? ')' : t.text === '[' ? ']' : '}');
      if (t.text !== '(') {
        levels.push(level());
        continue;
      }
      const inner = next?.kind === 'word' ? next.value : undefined;
      if (pendingCte && prev?.kind === 'word' && (prev.value === 'as' || prev.value === 'materialized')) {
        const body = level({ defines: pendingCte });
        pendingCte = undefined;
        levels.push(body);
        statementStart = true;
      } else if (wasExpecting && !(inner && QUERY_STARTS.has(inner))) {
        // (input JOIN t ON ...), or ((SELECT ...)): tables, or another paren to look into.
        levels.push(level({ fromList: true }));
        expectTable = true;
      } else {
        // A quoted name is an ordinary function, even "extract": only the keyword takes FROM in its arguments.
        const call = prev?.kind === 'word' ? (NOT_CALLS.has(prev.value) ? undefined : prev.value) : prev?.kind === 'quoted' ? `"${prev.value}"` : undefined;
        levels.push(level({ call }));
        statementStart = true;
      }
      continue;
    }
    if (t.text === ')' || t.text === ']' || t.text === '}') {
      if (closers.pop() !== t.text) return `there’s a ${t.text} without its opening bracket`;
      if (pivot?.level === levels.length && !pivot.values) return PIVOT_VALUES;
      if (pivot?.level === levels.length) pivot = undefined;
      const closed = levels.pop()!;
      if (closed.defines) {
        const outer = levels[levels.length - 1]!;
        outer.ctes.add(closed.defines);
        // After a CTE body: another CTE, or the query itself.
        if (next?.text === ',') outer.withList = true;
        else statementStart = true;
      }
      continue;
    }

    if (here.withList) {
      // A recursive CTE that doesn't recurse could read an outer table of the same name, so none are allowed.
      if (word === 'recursive') return 'WITH RECURSIVE isn’t supported in a step';
      if (t.text === ',') continue;
      if (name != null) {
        // name [(columns)] [USING KEY (...)] AS [NOT] [MATERIALIZED] ( body )
        here.withList = false;
        pendingCte = name;
        continue;
      }
      return 'name each CTE: WITH name AS (SELECT ...)';
    }

    if (word === 'with') {
      // unnest(...) WITH ORDINALITY and FETCH ... WITH TIES aren't CTE lists.
      if (next?.kind === 'word' && (next.value === 'ordinality' || next.value === 'ties')) continue;
      here.withList = true;
      continue;
    }
    if (t.text === ',' && here.fromList) {
      expectTable = true;
      continue;
    }
    if (word === 'from') {
      // a IS [NOT] DISTINCT FROM b compares; extract(year FROM d) and friends take FROM as an argument word.
      const before = tokens[k - 2];
      const distinct = prev?.kind === 'word' && prev.value === 'distinct' && before?.kind === 'word' && (before.value === 'is' || before.value === 'not');
      if (!distinct && !(here.call && FROM_IN_ARGUMENTS.has(here.call))) {
        here.fromList = true;
        expectTable = true;
      }
      continue;
    }
    if (word === 'join') {
      here.fromList = true;
      expectTable = true;
      continue;
    }
    if (atStart && word && READS_TABLE.has(word)) {
      expectTable = true;
      if (word === 'pivot' || word === 'pivot_wider') pivot = { level: levels.length, values: false };
      continue;
    }
    if (word === 'in' && pivot?.level === levels.length) pivot.values = true;
    if (word && FROM_LIST_ENDS.has(word)) {
      here.fromList = false;
      if (SET_OPERATIONS.has(word)) statementStart = true;
      continue;
    }
    // UNION ALL SELECT, UNION BY NAME FROM: the words between keep the statement start.
    if (atStart && prev && (SET_OPERATIONS.has(prev.value) || prev.value === 'by') && word && ['all', 'distinct', 'by', 'name'].includes(word)) statementStart = true;
  }
  if (pivot && !pivot.values) return PIVOT_VALUES;
  if (closers.length) return `close every ${({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[closers[closers.length - 1]!]}`;
  if (pendingCte) return `give ${pendingCte} a body: ${pendingCte} AS (SELECT ...)`;
  return undefined;
}

/**
 * The query as it goes to DuckDB: comments become spaces (keeping line breaks, so DuckDB's LINE numbers still
 * count the user's lines), and a trailing ; goes. Call only on a query customSqlProblem accepts.
 */
export function cleanCustomSql(sql: string): string {
  let out = '';
  let at = 0;
  for (const t of lexSql(sql)) {
    if (t.kind !== 'comment') continue;
    out += sql.slice(at, t.start) + t.text.replace(/[^\n\r]/g, ' ');
    at = t.start + t.text.length;
  }
  out += sql.slice(at);
  return out.replace(/[\s;]+$/, '');
}
