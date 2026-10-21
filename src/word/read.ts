/**
 * Tables in a Word document (.docx). A document is a zip whose word/document.xml holds the body: paragraphs (w:p)
 * and tables (w:tbl) of rows (w:tr) of cells (w:tc). readWordTables pulls every table out as a grid of cell text,
 * a cell merged across columns (w:gridSpan) repeated across them and one merged down rows (w:vMerge) taking the
 * value above, so every row has a cell for every column, as Word shows it. Each table is labelled by its caption
 * (a Caption paragraph just below or above it), else the heading above it, else "Table 3". Pure: bytes in, tables
 * out, shared by the browser and the runner.
 */
import { listZip, readZipEntry, zipEntry } from '../archive/zip';
import { columnNames } from '../sources/html';
import { localName, readXml, XmlError } from '../xml';

export interface WordTable {
  /** Position among the tables in the document, from 1. */
  index: number;
  /** The caption or heading that names it, else "Table 3". */
  label: string;
  /** Every row with a cell for every column, as text. */
  cells: string[][];
}

/** What the inspector lists for each table. */
export interface WordTableInfo {
  index: number;
  label: string;
  rows: number;
  columns: number;
}

export class WordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WordError';
  }
}

const MAX_LABEL = 80;
/** A paragraph style that names what follows or precedes it. */
const isHeading = (style: string) => /^(Heading|Title|Subtitle)/i.test(style);
const isCaption = (style: string) => /^Caption/i.test(style);

interface Cell {
  text: string[];
  span: number;
  /** Merged with the cell above: 'restart' starts a merge, 'continue' takes the value above. */
  vMerge?: 'restart' | 'continue';
}

/** The tables of the document body, from its XML. */
export async function readWordXml(xml: Uint8Array | string): Promise<WordTable[]> {
  const tables: WordTable[] = [];
  // A table being read, with the ones it is nested in (a table inside a cell is read as that cell's text).
  const open: { rows: Cell[][]; row?: Cell[]; cell?: Cell }[] = [];
  // Paragraphs outside tables, as the labels come from them.
  let paragraph: { text: string[]; style: string } | undefined;
  let lastParagraph: { text: string; style: string } | undefined;
  /** The table just closed, whose caption may follow it. */
  let justClosed: { table: WordTable; named: boolean } | undefined;
  let skip = 0;
  /** Tables open inside a cell: their rows and cells are only that cell's text. */
  let nested = 0;
  const cell = () => open[open.length - 1]?.cell;
  const label = (named: boolean, fallback: string) => {
    if (named) return fallback;
    const p = lastParagraph;
    if (p && (isCaption(p.style) || isHeading(p.style) || p.text.length <= MAX_LABEL)) return p.text;
    return fallback;
  };
  const handler = {
    open(name: string, attributes: [string, string][]) {
      const local = localName(name);
      if (skip || local === 'del' || local === 'instrText' || local === 'delText') {
        skip++;
        return;
      }
      const inner = cell();
      switch (local) {
        case 'tbl':
          if (inner) {
            nested++;
            inner.text.push('');
          } else open.push({ rows: [] });
          return;
        case 'tr':
          if (open.length && !inner) open[open.length - 1]!.row = [];
          return;
        case 'tc': {
          const t = open[open.length - 1];
          if (t?.row && !inner) t.row.push((t.cell = { text: [''], span: 1 }));
          return;
        }
        case 'gridSpan':
          if (inner && !nested) inner.span = Math.max(1, Number.parseInt(attributes.find(([a]) => localName(a) === 'val')?.[1] ?? '1', 10) || 1);
          return;
        case 'vMerge':
          if (inner && !nested) inner.vMerge = (attributes.find(([a]) => localName(a) === 'val')?.[1] ?? 'continue') === 'restart' ? 'restart' : 'continue';
          return;
        case 'p':
          if (inner) inner.text.push('');
          else if (!open.length) paragraph = { text: [''], style: '' };
          return;
        case 'pStyle':
          if (paragraph && !inner) paragraph.style = attributes.find(([a]) => localName(a) === 'val')?.[1] ?? '';
          return;
        case 'tab':
        case 'br':
        case 'cr':
          append(inner, paragraph, ' ');
          return;
        default:
          return;
      }
    },
    text(text: string) {
      if (skip) return;
      append(cell(), paragraph, text);
    },
    close(name: string) {
      if (skip) {
        skip--;
        return;
      }
      const local = localName(name);
      const t = open[open.length - 1];
      if (nested) {
        if (local === 'tbl') nested--;
        return;
      }
      if (local === 'tc' && t?.cell) t.cell = undefined;
      else if (local === 'tr' && t?.row && !t.cell) {
        t.rows.push(t.row);
        t.row = undefined;
      } else if (local === 'tbl' && t && !t.cell) {
        open.pop();
        const index = tables.length + 1;
        const fallback = `Table ${index}`;
        const named = lastParagraph !== undefined && isCaption(lastParagraph.style);
        const table: WordTable = { index, label: label(false, fallback), cells: grid(t.rows) };
        tables.push(table);
        justClosed = { table, named };
        lastParagraph = undefined;
      } else if (local === 'p' && paragraph && !open.length) {
        const text = paragraph.text.join(' ').replace(/\s+/g, ' ').trim();
        if (text) {
          // A caption written below its table names it, over the heading above.
          if (justClosed && isCaption(paragraph.style) && !justClosed.named) justClosed.table.label = text;
          lastParagraph = { text, style: paragraph.style };
        }
        justClosed = undefined;
        paragraph = undefined;
      }
    },
  };
  try {
    await readXml(xml, handler);
  } catch (e) {
    if (e instanceof XmlError) throw new WordError(`This Word document can’t be read: ${e.message}`);
    throw e;
  }
  return tables;
}

function append(cell: Cell | undefined, paragraph: { text: string[] } | undefined, text: string) {
  const target = cell?.text ?? paragraph?.text;
  if (target) target[target.length - 1] += text;
}

/** Rows of cell text with a cell for every column: spans repeated across, merges taking the value above. */
function grid(rows: Cell[][]): string[][] {
  const out: string[][] = [];
  for (const row of rows) {
    const cells: string[] = [];
    for (const c of row) {
      const text = c.text.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
      for (let i = 0; i < c.span; i++) {
        const col = cells.length;
        cells.push(c.vMerge === 'continue' ? (out[out.length - 1]?.[col] ?? text) : text);
      }
    }
    out.push(cells);
  }
  const width = Math.max(0, ...out.map((r) => r.length));
  return out.map((r) => (r.length < width ? [...r, ...Array.from({ length: width - r.length }, () => '')] : r));
}

/** The tables of a .docx file. */
export async function readWordTables(bytes: Uint8Array): Promise<WordTable[]> {
  let entries;
  try {
    entries = listZip(bytes);
  } catch (e) {
    throw new WordError(`This isn’t a Word document Puddle can read (${e instanceof Error ? e.message : String(e)}). Save it again as a .docx file.`);
  }
  const main = entries.find((e) => e.name === 'word/document.xml') ?? entries.find((e) => /^word\/document\d*\.xml$/.test(e.name));
  if (!main) throw new WordError(entries.some((e) => e.name.startsWith('xl/')) ? 'This is a workbook, not a Word document: choose Excel as its format.' : 'This isn’t a Word document: it has no word/document.xml inside. Save it again as a .docx file.');
  return readWordXml(await readZipEntry(bytes, zipEntry(entries, main.name)));
}

export const wordTableInfo = (t: WordTable): WordTableInfo => ({ index: t.index, label: t.label, rows: t.cells.length, columns: t.cells[0]?.length ?? 0 });

/** "Sales by region (4 rows, 3 columns)" for the Table picker. */
export function wordTableLabel(t: WordTableInfo): string {
  const n = (count: number, word: string) => `${count.toLocaleString('en-GB')} ${count === 1 ? word : `${word}s`}`;
  return `${t.label} (${n(t.rows, 'row')}, ${n(t.columns, 'column')})`;
}

/** The biggest table: the one a document's data is likeliest in, as the largest table on a sheet is. */
export const likeliestTable = (tables: WordTable[]): WordTable | undefined => [...tables].sort((a, b) => b.cells.length * (b.cells[0]?.length ?? 0) - a.cells.length * (a.cells[0]?.length ?? 0) || a.index - b.index)[0];

/** A table as columns and rows: the first row as the column names unless `header` is false. */
export function wordTableToRows(table: WordTable, { header = true }: { header?: boolean } = {}): { columns: string[]; rows: string[][] } {
  const width = table.cells[0]?.length ?? 0;
  const columns = header ? columnNames(table.cells.slice(0, 1), width) : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  return { columns, rows: header ? table.cells.slice(1) : table.cells };
}
