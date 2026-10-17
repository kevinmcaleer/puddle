import { fullCount } from '../ui/format';

/**
 * The results grid's name for screen readers: whose rows they are and how many. The grid itself tells them which row
 * and column they're on (aria-rowcount and aria-colcount); this says the size before they go in. Rows are still
 * being counted until `rows` is known.
 */
export function gridLabel(name: string, rows: number | undefined, columns: number) {
  const r = rows == null ? 'counting rows' : `${fullCount(rows)} ${rows === 1 ? 'row' : 'rows'}`;
  return `Results of ${name}: ${r}, ${fullCount(columns)} ${columns === 1 ? 'column' : 'columns'}`;
}
