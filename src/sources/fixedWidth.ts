// Fixed-width text: mainframe and SAP extracts, US government data, terminal output pasted in. Columns sit at the
// same character offsets on every line, with spaces between them. The boundaries are found from the columns of
// spaces that run down the whole table, and the rows are written as CSV for DuckDB (as XML is). Pure, so the
// runner reads it too, and the tests run on strings.

export interface FixedWidthOptions {
  /** The offsets at which each column after the first starts; found from the text when not given. */
  boundaries?: number[];
  /** Whether the first line names the columns (default true). */
  header?: boolean;
  /** Lines skipped at the top (a banner), blank ones included. */
  skip?: number;
  /** Rows dropped from the end (a footer). */
  skipBottom?: number;
}

export interface FixedWidthTable {
  columns: string[];
  rows: string[][];
  /** The boundaries used, so the inspector can show them. */
  boundaries: number[];
}

const splitLines = (text: string) => text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);

/** The lines the table is read from: the raw lines less the skipped ones, with blank lines left out. */
function tableLines(text: string, o: FixedWidthOptions): string[] {
  const raw = splitLines(text).slice(o.skip ?? 0);
  const lines = raw.filter((l) => l.trim().length > 0);
  return o.skipBottom ? lines.slice(0, Math.max(0, lines.length - o.skipBottom)) : lines;
}

/** How many lines, at most, the boundaries are read from. */
const SAMPLE = 500;
/** The share of lines that must have a space at an offset for it to be part of a gap: a value may spill into a gap on the odd line. */
const GAP_SHARE = 0.98;

/**
 * The column boundaries of fixed-width lines: the offset after each run of character positions that is a space on
 * (nearly) every line of the table's width, leaving out the margin before the first column and the end of the lines.
 * Lines much shorter than the table (a banner, a footer) are left out of the count.
 */
export function detectBoundaries(lines: string[]): number[] {
  const sample = lines.filter((l) => l.trim().length > 0).slice(0, SAMPLE);
  if (!sample.length) return [];
  // The table's width is the typical line's, so one line that spills past the rest doesn't set it.
  const lengths = sample.map((l) => l.length).sort((a, b) => a - b);
  const typical = lengths[Math.floor(lengths.length / 2)]!;
  const table = sample.filter((l) => l.length >= typical * 0.6);
  if (table.length < 2) return [];
  const width = Math.max(...table.map((l) => l.length));
  const spaces = new Array<number>(width).fill(0);
  for (const l of table) for (let i = 0; i < width; i++) if ((l[i] ?? ' ') === ' ') spaces[i]!++;
  const gap = (i: number) => spaces[i]! >= table.length * GAP_SHARE;
  const boundaries: number[] = [];
  let inGap = gap(0);
  let seenText = !inGap;
  for (let i = 1; i < width; i++) {
    const g = gap(i);
    if (g && !inGap) inGap = true;
    else if (!g && inGap) {
      inGap = false;
      // A gap before any text is the left margin, not a boundary.
      if (seenText) boundaries.push(i);
      seenText = true;
    }
  }
  return boundaries;
}

/** Column names from the header line's cells, as DuckDB names them: trimmed, an empty one `column<i>`, a repeat suffixed `_1`. */
export function nameColumns(cells: (string | undefined)[], count: number): string[] {
  const seen = new Map<string, number>();
  return Array.from({ length: Math.max(count, cells.length) }, (_, i) => {
    const base = cells[i]?.trim() || `column${i}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}_${n}` : base;
  });
}

/** One line cut at the boundaries, each cell trimmed. */
export function cutLine(line: string, boundaries: number[]): string[] {
  const cells: string[] = [];
  let from = 0;
  for (const b of boundaries) {
    cells.push(line.slice(from, b).trim());
    from = b;
  }
  cells.push(line.slice(from).trim());
  return cells;
}

/** Read fixed-width text into columns and rows, finding the boundaries when none are given. */
export function readFixedWidth(text: string, o: FixedWidthOptions = {}): FixedWidthTable {
  const lines = tableLines(text, o);
  const boundaries = [...new Set((o.boundaries ?? detectBoundaries(lines)).filter((b) => Number.isInteger(b) && b > 0))].sort((a, b) => a - b);
  const header = o.header ?? true;
  const cut = lines.map((l) => cutLine(l, boundaries));
  const first = cut[0] ?? [];
  const columns = nameColumns(header ? first : [], boundaries.length + 1);
  const rows = (header ? cut.slice(1) : cut).map((r) => (r.length < columns.length ? [...r, ...new Array<string>(columns.length - r.length).fill('')] : r));
  return { columns, rows, boundaries };
}

/** Add, remove or move a boundary: the list stays sorted, without repeats, and never at the start of the line. */
export function withBoundary(boundaries: number[], at: number, to?: number): number[] {
  const next = new Set(boundaries);
  if (to == null) {
    if (next.has(at)) next.delete(at);
    else next.add(at);
  } else {
    next.delete(at);
    next.add(to);
  }
  return [...next].filter((b) => b > 0).sort((a, b) => a - b);
}
