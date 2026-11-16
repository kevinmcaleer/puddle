// Which words of a SQL query are keywords, for writing them in capitals as they are typed.
import { lexSql, SqlRefusal, type SqlToken } from '../compiler';

/**
 * The words written in capitals. Kept to the words that are only ever SQL's own: a word that is as likely a column
 * (name, date, year, value, type, key, status) is left as typed.
 */
const KEYWORDS = new Set(
  (
    'select from where group by having order limit offset qualify window distinct all as on using ' +
    'join inner left right full outer cross natural semi anti asof lateral positional ' +
    'and or not in is null like ilike similar between exists any some escape ' +
    'case when then else end cast true false ' +
    'union intersect except with recursive values ' +
    'create replace table view temp temporary if ' +
    'asc desc nulls over partition filter pivot unpivot interval'
  ).split(' '),
);

/** Keywords that are also functions: left(s, 2), replace(s, a, b), if(c, a, b). Followed by a bracket they are left alone. */
const ALSO_FUNCTIONS = new Set(['left', 'right', 'replace', 'if']);

/** After NULLS, FIRST and LAST are keywords; anywhere else they are functions or names. */
const AFTER_NULLS = new Set(['first', 'last']);

/** One edit: the characters from `from` to `to` become `insert`, which is always as long as what it replaces. */
export interface CaseChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * The keywords of `sql` not yet in capitals, as edits that put them there. Names, strings and comments are never
 * touched, nor a word after a dot or after AS (a column or an alias, whatever it spells). The word the caret is in
 * or at the end of is still being typed (`or` may yet be `orders`), so it waits; pass no caret to take every word.
 * SQL the lexer won't read (an open quote, say) gets no edits until it reads again.
 */
export function keywordCase(sql: string, caret?: number): CaseChange[] {
  let tokens: SqlToken[];
  try {
    tokens = lexSql(sql).filter((t) => t.kind !== 'comment');
  } catch (e) {
    if (e instanceof SqlRefusal) return [];
    throw e;
  }
  const out: CaseChange[] = [];
  tokens.forEach((t, i) => {
    if (t.kind !== 'word') return;
    const [prev, next] = [tokens[i - 1], tokens[i + 1]];
    const keyword = KEYWORDS.has(t.value) || (AFTER_NULLS.has(t.value) && prev?.kind === 'word' && prev.value === 'nulls');
    if (!keyword) return;
    if (prev?.text === '.' || next?.text === '.') return;
    if (prev?.kind === 'word' && prev.value === 'as' && t.value !== 'select' && t.value !== 'with' && t.value !== 'values' && t.value !== 'not') return;
    if (ALSO_FUNCTIONS.has(t.value) && next?.text === '(') return;
    const to = t.start + t.text.length;
    if (caret != null && caret >= t.start && caret <= to) return;
    const upper = t.text.toUpperCase();
    if (upper !== t.text) out.push({ from: t.start, to, insert: upper });
  });
  return out;
}

/** `sql` with every keyword in capitals. */
export function upperKeywords(sql: string): string {
  let out = sql;
  for (const c of keywordCase(sql)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}
