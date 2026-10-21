// The check on a query puddle-connect runs for a database it can't open read-only (plan section 4): one statement,
// and one that reads. Comments and string literals are blanked first, so a semicolon or keyword inside them is not
// taken for one outside. Pure, and deliberately strict: a statement it can't place is refused.

const READS = ['select', 'with', 'show', 'describe', 'desc', 'explain', 'values', 'table'];

/** The SQL with its comments and string literals blanked (their length kept), so structure can be read. */
export function blankLiterals(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\' && c !== '`') j += 2;
        else if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) break;
        else j++;
      }
      const stop = Math.min(sql.length, j + 1);
      out += c + ' '.repeat(Math.max(0, stop - i - 2)) + (stop - i >= 2 ? c : '');
      i = stop;
    } else if (c === '$' && /^\$[A-Za-z_]*\$/.test(sql.slice(i))) {
      // A PostgreSQL dollar-quoted string.
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))![0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      out += ' '.repeat(stop - i);
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Why the statement can't run, or undefined when it is one reading statement. */
export function statementProblem(sql: string): string | undefined {
  const blank = blankLiterals(sql).trim().replace(/;\s*$/, '');
  if (!blank.trim()) return 'The query is empty.';
  if (blank.includes(';')) return 'One statement at a time: the query has a semicolon in it.';
  const word = /^[(\s]*([A-Za-z_]+)/.exec(blank)?.[1]?.toLowerCase();
  if (!word || !READS.includes(word)) return `Only a query that reads can run here (SELECT, WITH, SHOW, DESCRIBE or EXPLAIN), not ${word ? word.toUpperCase() : 'that'}.`;
  // A WITH that ends in a write (WITH x AS (...) INSERT ...), or a SELECT ... INTO a new table.
  const outer = blank.replace(/\([^()]*\)/g, ' ').replace(/\([^()]*\)/g, ' ').replace(/\([^()]*\)/g, ' ');
  if (/\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|replace|call|exec|execute|copy|load|attach|detach|install|set|pragma|vacuum|into)\b/i.test(outer)) return 'Only a query that reads can run here: the statement writes, creates or changes something.';
  return undefined;
}
