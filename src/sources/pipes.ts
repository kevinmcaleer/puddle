// Pipe tables: SAP ALV lists printed to text and Markdown tables. Rows sit between a `|` at each end; around them
// are banners, rules of dashes, a page header printed again. Read as `|`-delimited with those lines dropped, the
// empty first and last columns the edge pipes make removed, every cell trimmed. Pure, so the runner reads it too.
import { nameColumns } from './fixedWidth';

export interface PipesOptions {
  /** Whether the first row names the columns (default true). */
  header?: boolean;
}

export interface PipesTable {
  columns: string[];
  rows: string[][];
  /** Lines that weren't rows of the table (banners, rules, page headers), for the inspector. */
  dropped: number;
}

const ROW = /^\s*\|.*\|\s*$/;
/** A Markdown alignment row (`|---|:--:|`) or an SAP rule inside pipes: every cell dashes, colons and spaces. */
const RULE_CELL = /^:?-*:?$/;

/** The cells of a row between pipes: split on the pipe, the empty edge cells dropped, each trimmed. */
export function pipeCells(line: string): string[] {
  const cells = line.trim().split('|').map((c) => c.trim());
  return cells.slice(1, -1);
}

/** Whether a line is a row of a pipe table. */
export const isPipeRow = (line: string) => ROW.test(line);

/** Read a pipe table into columns and rows. A row equal to the header (a page header printed again) is dropped. */
export function readPipes(text: string, o: PipesOptions = {}): PipesTable {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const header = o.header ?? true;
  let dropped = 0;
  const rows: string[][] = [];
  for (const line of lines) {
    if (!isPipeRow(line)) {
      if (line.trim()) dropped++;
      continue;
    }
    const cells = pipeCells(line);
    if (cells.every((c) => RULE_CELL.test(c))) {
      dropped++;
      continue;
    }
    rows.push(cells);
  }
  const first = rows[0] ?? [];
  const width = Math.max(0, ...rows.map((r) => r.length));
  const columns = nameColumns(header ? first : [], width);
  const data = (header ? rows.slice(1) : rows).filter((r) => {
    const again = header && r.length === first.length && r.every((c, i) => c === first[i]);
    if (again) dropped++;
    return !again;
  });
  return { columns, rows: data.map((r) => (r.length < columns.length ? [...r, ...new Array<string>(columns.length - r.length).fill('')] : r)), dropped };
}
