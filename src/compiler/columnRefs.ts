// Columns named inside an expression or a custom SQL query, found and renamed through the custom SQL lexer, so a
// template's expression steps can follow a column mapped to another name (templates/mapping.ts).
import { lexSql, SqlRefusal, type SqlToken } from './customSql';
import { ident } from './sql';

/** Words and quoted names that may be a column: not a function being called, a table before a dot or after FROM or JOIN, or a new name after AS. */
function nameTokens(sql: string): SqlToken[] {
  let tokens: SqlToken[];
  try {
    tokens = lexSql(sql).filter((t) => t.kind !== 'comment');
  } catch (e) {
    // Text the lexer won't read can't be searched: it names nothing that could be mapped.
    if (e instanceof SqlRefusal) return [];
    throw e;
  }
  return tokens.filter((t, i) => {
    if (t.kind !== 'word' && t.kind !== 'quoted') return false;
    const next = tokens[i + 1];
    const before = tokens[i - 1];
    if (t.kind === 'word' && next?.kind === 'op' && next.text === '(') return false;
    if (next?.kind === 'op' && next.text === '.') return false;
    if (before?.kind === 'word' && (before.value === 'as' || before.value === 'from' || before.value === 'join')) return false;
    return true;
  });
}

/** Which of `columns` the text names, in the order of `columns`. Names ignore case, as in DuckDB. */
export function sqlColumnRefs(sql: string, columns: string[]): string[] {
  const named = new Set(nameTokens(sql).map((t) => t.value));
  return columns.filter((c) => named.has(c.toLowerCase()));
}

/** A column as it would be typed: bare when it can be, quoted otherwise. */
const written = (name: string) => (/^[a-z_][a-z0-9_]*$/.test(name) ? name : ident(name));

/**
 * The text with every column in `renames` (old name to new, ignoring case) written as its new name. A quoted name
 * stays quoted. Everything else, comments and strings included, is left exactly as it was.
 */
export function renameSqlColumns(sql: string, renames: Record<string, string>): string {
  const lower = new Map(Object.entries(renames).map(([from, to]) => [from.toLowerCase(), to]));
  let out = sql;
  for (const t of nameTokens(sql).reverse()) {
    const to = lower.get(t.value);
    if (to == null) continue;
    out = out.slice(0, t.start) + (t.kind === 'quoted' ? ident(to) : written(to)) + out.slice(t.start + t.text.length);
  }
  return out;
}
