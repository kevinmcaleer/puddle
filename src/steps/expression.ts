// Column completion for expression inputs.
import { ident } from '../compiler';
import type { ColumnSchema } from '../model';

/** The word being typed just before the caret, and where it starts. */
export function wordAt(text: string, caret: number): { word: string; start: number } {
  const m = /[A-Za-z_][\w]*$|"[^"]*$/.exec(text.slice(0, caret));
  return m ? { word: m[0].replace(/^"/, ''), start: m.index } : { word: '', start: caret };
}

/** Columns whose names start with (then contain) the word, best first. */
export function suggest(columns: ColumnSchema[], word: string, max = 6): ColumnSchema[] {
  if (!word) return [];
  const w = word.toLowerCase();
  const starts = columns.filter((c) => c.name.toLowerCase().startsWith(w));
  const contains = columns.filter((c) => !starts.includes(c) && c.name.toLowerCase().includes(w));
  return [...starts, ...contains].filter((c) => c.name !== word).slice(0, max);
}

/** Replace the word before the caret with a column, quoted only when it has to be. */
export function insertColumn(text: string, caret: number, column: string): { text: string; caret: number } {
  const { start } = wordAt(text, caret);
  const name = /^[a-z_][a-z0-9_]*$/.test(column) ? column : ident(column);
  return { text: text.slice(0, start) + name + text.slice(caret), caret: start + name.length };
}
