// Column names: what makes one untidy, and the tidy name for it in the project's chosen style.
import type { ColumnNamesMode } from '../model';

/** Characters that have no place in a name: control characters, zero-width characters, a no-break space, a byte-order mark. */
// eslint-disable-next-line no-control-regex -- the control characters are the point
const HIDDEN = new RegExp('[\\u0000-\\u001F\\u007F\\u00A0\\u200B-\\u200D\\u2060\\uFEFF]', 'g');

/** The name with hidden characters out, spaces at the ends off and runs of spaces collapsed. */
export const tidyName = (name: string) => name.replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim();

/** The name in snake_case: lower case, words joined with one underscore, nothing else. "Doc. no." → doc_no, orderDate → order_date. */
export function snakeName(name: string): string {
  const words = tidyName(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return words.join('_');
}

/** The name a column should have in this style, or the name itself when it is tidy already. */
export function tidiedName(name: string, mode: ColumnNamesMode): string {
  const tidy = mode === 'snake' ? snakeName(name) : tidyName(name);
  return tidy || name;
}

/**
 * The renames that tidy these column names in the chosen style, each to a name no other column has (a clash takes
 * _1, _2). Columns already tidy are left out.
 */
export function tidyRenames(columns: string[], mode: ColumnNamesMode): { from: string; to: string }[] {
  const taken = new Set(columns);
  const out: { from: string; to: string }[] = [];
  for (const from of columns) {
    let to = tidiedName(from, mode);
    if (to === from) continue;
    taken.delete(from);
    const base = to;
    for (let i = 1; taken.has(to); i++) to = `${base}_${i}`;
    taken.add(to);
    out.push({ from, to });
  }
  return out;
}
