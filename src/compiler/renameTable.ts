// Renaming a table in SQL someone wrote: a SQL node's query or script, or the SQL kept on a Query. Only names that
// read the table are rewritten, where they are; strings, comments, CTEs and tables a script makes are left alone.
import { lexSql, SqlRefusal, type SqlToken } from './customSql';
import { sqlName } from './querySql';
import { scriptTableRefs } from './sqlScript';

const isName = (t: SqlToken | undefined) => !!t && (t.kind === 'word' || t.kind === 'quoted');

/** Whether the SQL already uses a name for anything: a table, a CTE, an alias or a column. False for text that can't be read. */
export function sqlUsesName(sql: string, name: string): boolean {
  const lower = name.toLowerCase();
  try {
    return lexSql(sql).some((t) => isName(t) && t.value === lower);
  } catch (e) {
    if (e instanceof SqlRefusal) return true;
    throw e;
  }
}

/**
 * The SQL with every read of the input table `from` written as `to`. `names` are all the names the SQL's inputs may
 * be read by, `from` among them. A statement that reads the table has its qualified columns (`from.column`) renamed
 * with it; a CTE or a script's own table of the same name isn't the input, so reads of those stay as written. Text
 * that can't be read comes back unchanged.
 */
export function renameTableInSql(sql: string, names: readonly string[], from: string, to: string): string {
  const old = from.toLowerCase();
  if (old === to.toLowerCase() && sqlName(from) === sqlName(to)) return sql;
  let tokens: SqlToken[];
  try {
    tokens = lexSql(sql).filter((t) => t.kind !== 'comment');
  } catch (e) {
    if (e instanceof SqlRefusal) return sql;
    throw e;
  }
  const reads = scriptTableRefs(sql, names).filter((r) => r.kind === 'input' && r.name === old);
  if (!reads.length) return sql;
  const spans = new Map(reads.map((r) => [r.start, r.end]));
  // Statement k of the script: tokens between its semicolons.
  const ends = tokens.filter((t) => t.kind === 'op' && t.text === ';').map((t) => t.start);
  const statementOf = (at: number) => ends.filter((e) => e < at).length;
  const reading = new Set(reads.map((r) => statementOf(r.start)));
  tokens.forEach((t, k) => {
    if (!isName(t) || t.value !== old || spans.has(t.start)) return;
    if (tokens[k + 1]?.text !== '.' || tokens[k - 1]?.text === '.') return;
    if (reading.has(statementOf(t.start))) spans.set(t.start, t.start + t.text.length);
  });
  const written = sqlName(to);
  let out = '';
  let at = 0;
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    out += sql.slice(at, start) + written;
    at = end;
  }
  return out + sql.slice(at);
}
