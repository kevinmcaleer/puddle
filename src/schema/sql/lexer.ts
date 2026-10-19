// Tokens and statements of a SQL script, for the DDL importer. It knows enough of each dialect's lexical rules to find
// where statements end: strings (with '' and, in MySQL, backslash escapes), quoted identifiers ("x", `x`, [x]), `--`,
// `#` (MySQL) and `/* */` comments, dollar-quoted strings (PostgreSQL, DuckDB), SQL Server's `GO` batch separator, the
// mysql client's `DELIMITER` command and SQLite trigger bodies. It is not a grammar: the reader makes sense of the tokens.
import type { SqlDialect } from './dialect';

export interface Token {
  /** word: a bare word or keyword; ident: a quoted identifier; string: a string literal; punct: anything else. */
  kind: 'word' | 'ident' | 'string' | 'number' | 'punct';
  /** The word, the identifier without its quotes, the string's text without quotes and escapes, or the punctuation. */
  value: string;
  /** Offsets in the script. */
  start: number;
  end: number;
  /** 1-based line the token starts on. */
  line: number;
}

export interface Statement {
  tokens: Token[];
  /** 1-based line of the statement's first token. */
  line: number;
  /** The script the offsets of the tokens point into. */
  source: string;
}

const isWordStart = (c: string) => /[\p{L}_]/u.test(c);
const isWordChar = (c: string) => /[\p{L}\p{N}_$@#]/u.test(c);

/** The script's statements, split at `;` (or the current `DELIMITER`), and at `GO` on a line of its own. */
export function splitStatements(sql: string, dialect: SqlDialect): Statement[] {
  const statements: Statement[] = [];
  let tokens: Token[] = [];
  let line = 1;
  let lineStart = true;
  let delimiter = ';';
  let i = 0;
  // Inside a SQLite trigger, BEGIN … END holds statements of its own. (MySQL dumps wrap theirs in DELIMITER.)
  let blocks = 0;
  const trigger = () => dialect === 'sqlite' && /^CREATE$/i.test(tokens[0]?.value ?? '') && tokens.slice(1, 4).some((t) => t.kind === 'word' && /^TRIGGER$/i.test(t.value));

  const flush = () => {
    blocks = 0;
    if (tokens.length) statements.push({ tokens, line: tokens[0]!.line, source: sql });
    tokens = [];
  };
  const advance = (to: number) => {
    for (let k = i; k < to && k < sql.length; k++) if (sql[k] === '\n') line++;
    i = to;
  };
  const push = (kind: Token['kind'], value: string, start: number, end: number, startLine: number) => {
    tokens.push({ kind, value, start, end, line: startLine });
  };

  while (i < sql.length) {
    const c = sql[i]!;
    const next = sql[i + 1] ?? '';
    if (c === '\n') {
      line++;
      i++;
      lineStart = true;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
      i++;
      continue;
    }
    const atLineStart = lineStart;
    lineStart = false;
    const startLine = line;
    const start = i;

    if (atLineStart && dialect === 'mysql') {
      const m = /^DELIMITER[ \t]+(\S+)/i.exec(sql.slice(i, i + 64));
      if (m) {
        flush();
        delimiter = m[1]!;
        advance(i + m[0].length);
        continue;
      }
    }
    if (delimiter !== ';' && sql.startsWith(delimiter, i)) {
      flush();
      advance(i + delimiter.length);
      continue;
    }
    if (c === '-' && next === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl < 0 ? sql.length : nl;
      continue;
    }
    if (c === '#' && dialect === 'mysql') {
      const nl = sql.indexOf('\n', i);
      i = nl < 0 ? sql.length : nl;
      continue;
    }
    if (c === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2);
      advance(close < 0 ? sql.length : close + 2);
      continue;
    }
    if (c === ';' && delimiter === ';' && blocks === 0) {
      i++;
      flush();
      continue;
    }

    // Strings: '...', N'...', E'...', X'...', B'...'.
    const prefixed = /[NnEeXxBb]/.test(c) && next === "'";
    if (c === "'" || prefixed) {
      const backslash = dialect === 'mysql' || ((c === 'E' || c === 'e') && prefixed);
      let k = prefixed ? i + 2 : i + 1;
      let value = '';
      while (k < sql.length) {
        const ch = sql[k]!;
        if (ch === "'" && sql[k + 1] === "'") {
          value += "'";
          k += 2;
        } else if (ch === "'") {
          k++;
          break;
        } else if (ch === '\\' && backslash && k + 1 < sql.length) {
          const e = sql[k + 1]!;
          value += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e === '0' ? '\0' : e;
          k += 2;
        } else {
          value += ch;
          k++;
        }
      }
      advance(k);
      push('string', value, start, k, startLine);
      continue;
    }

    // Dollar-quoted strings: $$...$$ and $tag$...$tag$.
    if (c === '$' && (dialect === 'postgres' || dialect === 'duckdb')) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const close = sql.indexOf(m[0], i + m[0].length);
        const end = close < 0 ? sql.length : close + m[0].length;
        const value = sql.slice(i + m[0].length, close < 0 ? sql.length : close);
        advance(end);
        push('string', value, start, end, startLine);
        continue;
      }
    }

    // Quoted identifiers: "x", `x`, and [x] where brackets quote.
    const bracket = c === '[' && (dialect === 'sqlserver' || dialect === 'sqlite');
    if (c === '"' || c === '`' || bracket) {
      const close = bracket ? ']' : c;
      let k = i + 1;
      let value = '';
      while (k < sql.length) {
        if (sql[k] === close && sql[k + 1] === close) {
          value += close;
          k += 2;
        } else if (sql[k] === close) {
          k++;
          break;
        } else value += sql[k++];
      }
      advance(k);
      push('ident', value, start, k, startLine);
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(next))) {
      const m = /^(?:0x[0-9a-fA-F]+|[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)/.exec(sql.slice(i, i + 128))!;
      i += m[0].length;
      push('number', m[0], start, i, startLine);
      continue;
    }

    if (isWordStart(c) || (c === '@' && dialect === 'sqlserver') || (c === '$' && /[0-9]/.test(next))) {
      let k = i + 1;
      while (k < sql.length && isWordChar(sql[k]!)) k++;
      const value = sql.slice(i, k);
      i = k;
      // GO on a line of its own (optionally with a count) ends a SQL Server batch.
      if (/^go$/i.test(value) && atLineStart) {
        const rest = /^[ \t]*(?:\d+)?[ \t]*(?:--[^\n]*)?(?:\r?\n|$)/.exec(sql.slice(i));
        if (rest) {
          flush();
          advance(i + rest[0].length);
          lineStart = true;
          continue;
        }
      }
      if (trigger()) {
        if (/^(BEGIN|CASE)$/i.test(value)) blocks++;
        else if (/^END$/i.test(value) && blocks > 0) blocks--;
      }
      push('word', value, start, i, startLine);
      continue;
    }

    const two = sql.slice(i, i + 2);
    const op = ['::', '<=', '>=', '<>', '!=', '||', '=>', '->'].includes(two) ? two : c;
    i += op.length;
    push('punct', op, start, i, startLine);
  }
  flush();
  return statements;
}
