/**
 * Tables in the text of a PDF. A machine-made PDF holds its text as positioned runs, not as tables: a table is rows
 * of runs on the same line with gaps between them, lined up in columns. findPdfTables takes each page's runs, joins
 * them into lines and cells (a gap wider than about an em starts a new cell), takes consecutive lines of two or more
 * cells as a table, and lines the cells up into columns by where they sit on the page, so right-aligned numbers fall
 * under their heading. A table is labelled by the line above it, else "Table 3", with its page. Pure: runs in, tables
 * out, shared by the browser and the runner; src/pdf/read.ts gets the runs out of the PDF.
 */
import type { WordTable } from '../word';

/** A run of text as pdf.js reports it: its bottom-left corner in points from the page's bottom left, and its size. */
export interface TextRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageText {
  /** From 1. */
  page: number;
  runs: TextRun[];
}

export interface PdfTable extends WordTable {
  page: number;
}

interface Cell {
  text: string;
  x0: number;
  x1: number;
}

interface Line {
  y: number;
  height: number;
  cells: Cell[];
}

const MAX_LABEL = 80;

/** Runs into lines (the same baseline, give or take half the height), each line's runs into cells. */
export function linesOf(runs: TextRun[]): Line[] {
  const sorted = runs.filter((r) => r.text.trim().length > 0).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; height: number; runs: TextRun[] }[] = [];
  for (const r of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - r.y) <= Math.max(2, Math.max(last.height, r.height) * 0.5)) last.runs.push(r);
    else lines.push({ y: r.y, height: r.height, runs: [r] });
  }
  return lines.map((l) => {
    const cells: Cell[] = [];
    for (const r of l.runs.sort((a, b) => a.x - b.x)) {
      const size = Math.max(r.height, 4);
      const last = cells[cells.length - 1];
      const gap = last ? r.x - last.x1 : Infinity;
      if (last && gap <= size * 1.2) {
        last.text = `${last.text}${gap > size * 0.12 && !last.text.endsWith(' ') && !r.text.startsWith(' ') ? ' ' : ''}${r.text}`;
        last.x1 = Math.max(last.x1, r.x + r.width);
      } else cells.push({ text: r.text, x0: r.x, x1: r.x + r.width });
    }
    return { y: l.y, height: l.height, cells: cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() })).filter((c) => c.text) };
  });
}

/** Cells of a block of lines into columns: a cell joins the column it overlaps on the page, else starts one. */
function columnsOf(lines: Line[]): { x0: number; x1: number }[] {
  const columns: { x0: number; x1: number }[] = [];
  for (const c of lines.flatMap((l) => l.cells).sort((a, b) => a.x0 - b.x0)) {
    const hit = columns.find((col) => c.x0 < col.x1 + 1 && c.x1 > col.x0 - 1);
    if (hit) hit.x1 = Math.max(hit.x1, c.x1);
    else columns.push({ x0: c.x0, x1: c.x1 });
  }
  return columns.sort((a, b) => a.x0 - b.x0);
}

/** Every table on these pages, in reading order. */
export function findPdfTables(pages: PageText[]): PdfTable[] {
  const tables: PdfTable[] = [];
  for (const page of pages) {
    const lines = linesOf(page.runs);
    let k = 0;
    while (k < lines.length) {
      if (lines[k]!.cells.length < 2) {
        k++;
        continue;
      }
      // Consecutive lines of two or more cells, no further apart than a couple of line heights.
      let end = k + 1;
      while (end < lines.length && lines[end]!.cells.length >= 2 && lines[end - 1]!.y - lines[end]!.y <= Math.max(lines[end]!.height, lines[end - 1]!.height) * 2.5) end++;
      if (end - k >= 2) {
        const block = lines.slice(k, end);
        const columns = columnsOf(block);
        const cells = block.map((l) => {
          const row = columns.map(() => '');
          for (const c of l.cells) {
            let best = 0;
            let overlap = -Infinity;
            columns.forEach((col, i) => {
              const o = Math.min(c.x1, col.x1) - Math.max(c.x0, col.x0);
              if (o > overlap) {
                overlap = o;
                best = i;
              }
            });
            row[best] = row[best] ? `${row[best]} ${c.text}` : c.text;
          }
          return row;
        });
        const index = tables.length + 1;
        const above = lines[k - 1];
        const label = above && above.cells.length === 1 && above.cells[0]!.text.length <= MAX_LABEL ? above.cells[0]!.text : `Table ${index}`;
        tables.push({ index, label: `${label} (page ${page.page})`, page: page.page, cells });
      }
      k = Math.max(end, k + 1);
    }
  }
  return tables;
}
