/**
 * Tables on a web page (Add source › From web page): find the <table> elements in a page's HTML, read each into
 * named columns and rows of text, and write the chosen one as CSV for DuckDB to read and type. Pure apart from
 * DOMParser, which the browser (and jsdom in tests) provides.
 */

export interface HtmlTable {
  /** Position among the tables found on the page, from 0. */
  index: number;
  /** The table's caption, else the heading above it, else "Table 3". */
  label: string;
  columns: string[];
  rows: string[][];
}

/** Which table a source reads, kept so the same table is found again when the page is fetched again. */
export interface TableRef {
  index: number;
  label: string;
}

/** Tables that frame a page rather than hold data: navigation boxes, notices, sidebars. */
const LAYOUT = /\b(navbox[\w-]*|metadata|[aotcf]?mbox[\w-]*|sidebar|vertical-navbox|toc)\b/;

/** What a cell shows, less footnote markers, hidden sort keys, edit links and scripts. */
const HIDDEN = 'sup.reference, .reference, .mw-editsection, .sortkey, .sorttext[style*="none"], style, script, noscript, template, [hidden], [style*="display:none"], [style*="display: none"]';

const MAX_SPAN = 1000;

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

export function cellText(cell: Element): string {
  const copy = cell.cloneNode(true) as Element;
  for (const el of copy.querySelectorAll(HIDDEN)) el.remove();
  for (const br of copy.querySelectorAll('br')) br.replaceWith(' ');
  // Blocks and cells inside a cell (a nested table, a list) are separate words, not run together.
  for (const el of copy.querySelectorAll('td, th, li, p, div')) el.append(' ');
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const span = (value: string | null, fallback: number) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_SPAN) : fallback;
};

interface Grid {
  cells: string[][];
  /** Per row: true when every cell in it is a <th>, or it sits in <thead>. */
  header: boolean[];
}

/** Lay the table's own rows out on a grid, repeating a cell across the columns and rows it spans. */
function toGrid(table: HTMLTableElement): Grid {
  const rows = [...table.rows];
  const cells: string[][] = rows.map(() => []);
  const header: boolean[] = [];
  rows.forEach((row, r) => {
    let c = 0;
    const own = [...row.cells];
    header.push(own.length > 0 && (row.parentElement?.tagName === 'THEAD' || own.every((cell) => cell.tagName === 'TH')));
    for (const cell of own) {
      while (cells[r]![c] !== undefined) c++;
      const text = cellText(cell);
      const cols = Math.max(1, span(cell.getAttribute('colspan'), 1));
      // rowspan="0" runs to the end of the table.
      const down = span(cell.getAttribute('rowspan'), 1) || rows.length - r;
      for (let dr = 0; dr < Math.max(1, down) && r + dr < rows.length; dr++)
        for (let dc = 0; dc < cols; dc++) if (cells[r + dr]![c + dc] === undefined) cells[r + dr]![c + dc] = text;
      c += cols;
    }
  });
  return { cells, header };
}

/** Column names from the header rows: each column's distinct texts top to bottom, unique and never empty. */
export function columnNames(headerRows: string[][], width: number): string[] {
  const seen = new Map<string, number>();
  return Array.from({ length: width }, (_, c) => {
    const parts: string[] = [];
    for (const row of headerRows) {
      const t = row[c] ?? '';
      if (t && parts[parts.length - 1] !== t) parts.push(t);
    }
    const base = parts.join(' ') || `Column ${c + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} ${n}`;
  });
}

function readTable(table: HTMLTableElement): Omit<HtmlTable, 'index' | 'label'> | undefined {
  const { cells, header } = toGrid(table);
  const width = Math.max(0, ...cells.map((r) => r.length));
  if (!width) return undefined;
  let heads = 0;
  while (heads < cells.length && header[heads]) heads++;
  // No header rows marked up: the first row names the columns, as most hand-made tables mean it to.
  if (heads === 0 || heads === cells.length) heads = 1;
  const columns = columnNames(cells.slice(0, heads), width);
  const rows = cells
    .slice(heads)
    .map((r) => Array.from({ length: width }, (_, c) => r[c] ?? ''))
    .filter((r) => r.some(Boolean));
  return rows.length ? { columns, rows } : undefined;
}

/** The nearest heading before each element, in document order. */
function headingsBefore(doc: Document): Map<Element, string> {
  const out = new Map<Element, string>();
  let heading = '';
  for (const el of doc.querySelectorAll('h1, h2, h3, h4, h5, h6, table')) {
    if (el.tagName === 'TABLE') out.set(el, heading);
    else heading = cellText(el);
  }
  return out;
}

/** The data tables on a page, in page order: layout tables, and tables with no rows under their header, are left out. */
export function findTables(doc: Document): HtmlTable[] {
  const headings = headingsBefore(doc);
  const found: HtmlTable[] = [];
  for (const table of doc.querySelectorAll('table')) {
    if (LAYOUT.test(table.className) || table.getAttribute('role') === 'presentation' || table.closest('.navbox')) continue;
    const read = readTable(table as HTMLTableElement);
    if (!read) continue;
    const caption = table.caption ? cellText(table.caption) : '';
    found.push({ index: found.length, label: caption || headings.get(table) || '', ...read });
  }
  // Tables under the same heading are told apart by number; tables with no name get one.
  const counts = new Map<string, number>();
  for (const t of found) counts.set(t.label, (counts.get(t.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const t of found) {
    const n = (seen.get(t.label) ?? 0) + 1;
    seen.set(t.label, n);
    if (!t.label) t.label = `Table ${t.index + 1}`;
    else if (counts.get(t.label)! > 1) t.label = `${t.label} (${n})`;
  }
  return found;
}

/** The table a source reads: the one with its label (tables come and go above it), else the one in its place. */
export function pickTable(tables: HtmlTable[], ref: TableRef): HtmlTable | undefined {
  const named = tables.filter((t) => t.label === ref.label);
  return named.find((t) => t.index === ref.index) ?? named[0] ?? tables[ref.index];
}

const csvField = (v: string) => (/[",\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v);

/** The table as CSV with a header row, every value quoted where it needs to be. */
export function tableToCsv(table: Pick<HtmlTable, 'columns' | 'rows'>): string {
  return [table.columns, ...table.rows].map((r) => r.map(csvField).join(',')).join('\n') + '\n';
}

/** "25 rows, 12 columns". */
export const tableSize = (t: Pick<HtmlTable, 'columns' | 'rows'>) =>
  `${t.rows.length} ${t.rows.length === 1 ? 'row' : 'rows'}, ${t.columns.length} ${t.columns.length === 1 ? 'column' : 'columns'}`;

/** The table to offer first: the one with the most rows, which on most pages is the data the page is about. */
export const likeliestTable = (tables: HtmlTable[]) => tables.reduce<HtmlTable | undefined>((best, t) => (!best || t.rows.length > best.rows.length ? t : best), undefined);
