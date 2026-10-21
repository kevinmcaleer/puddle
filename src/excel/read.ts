// Reading spreadsheets (.xlsx and the other formats in ./formats) with SheetJS into typed columns. Runs in the
// Excel worker (src/excel/worker.ts), and directly in tests.
import * as XLSX from 'xlsx';
import { columnLetters, formatRange, intersect, parseRange, type CellRange } from './range';
import { ExcelError, type SheetColumn, type SheetData, type SheetInfo, type SheetReadOptions, type SheetTable } from './types';

const startsWith = (data: Uint8Array, magic: number[]) => magic.every((b, i) => data[i] === b);
const ascii = (data: Uint8Array, text: string) => startsWith(data, [...text].map((ch) => ch.charCodeAt(0)));

/**
 * Whether the bytes are plain text that isn't one of the text spreadsheet formats (SYLK, DIF, a flat OpenDocument
 * file): SheetJS would read any such text as a CSV, which is read by DuckDB instead, with the options its sniff chose.
 */
function isPlainText(data: Uint8Array): boolean {
  const probe = data.subarray(0, 512);
  for (const b of probe) if (b === 0 || (b < 0x09 && b !== 0) || (b > 0x0d && b < 0x20)) return false;
  if (ascii(data, 'ID;') || ascii(data, 'TABLE')) return false;
  if (ascii(data, '<?xml') || ascii(data, '<office:')) return new TextDecoder().decode(data.subarray(0, 4096)).indexOf('office:document') < 0;
  return true;
}

/**
 * Parse a spreadsheet's bytes: a workbook in any format SheetJS reads (see ./formats). Plain text is refused, since
 * SheetJS would read it as a CSV, and a password-protected workbook is named for what it is.
 */
export function parseWorkbook(data: Uint8Array): XLSX.WorkBook {
  if (isPlainText(data)) throw new ExcelError('This file isn’t a spreadsheet. Save it from your spreadsheet program as .xlsx, or add it as a CSV.');
  try {
    // Dense sheets use less memory; number formats (cellNF) tell dates from numbers.
    return XLSX.read(data, { type: 'array', dense: true, cellNF: true, cellDates: false, cellHTML: false, cellFormula: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/password/i.test(message)) throw new ExcelError('This workbook is password-protected. Remove the password, save it, and add it again.');
    throw new ExcelError(`This spreadsheet can’t be read (${message}). Open it in your spreadsheet program, save it again as .xlsx, and add it again.`);
  }
}

const usedRange = (ws: XLSX.WorkSheet): CellRange | undefined => (ws['!ref'] ? (XLSX.utils.decode_range(ws['!ref']) as CellRange) : undefined);

/** Every sheet with the size of its used range, in workbook order. */
export function listSheets(wb: XLSX.WorkBook): SheetInfo[] {
  return wb.SheetNames.map((name) => {
    const r = usedRange(wb.Sheets[name]!);
    return { name, rows: r ? r.e.r - r.s.r + 1 : 0, columns: r ? r.e.c - r.s.c + 1 : 0 };
  });
}

function cellGetter(ws: XLSX.WorkSheet): (r: number, c: number) => XLSX.CellObject | undefined {
  const dense = ws['!data'] as XLSX.CellObject[][] | undefined;
  if (dense) return (r, c) => dense[r]?.[c];
  return (r, c) => ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
}

/** Empty cells, stubs and error values (#N/A, #DIV/0!) all read as empty. */
const isEmpty = (cell: XLSX.CellObject | undefined): boolean =>
  !cell || cell.t === 'z' || cell.t === 'e' || cell.v == null || (cell.t === 's' && String(cell.v) === '');

const isDateCell = (cell: XLSX.CellObject) => cell.t === 'd' || (cell.t === 'n' && typeof cell.z === 'string' && (XLSX.SSF.is_date(cell.z) as boolean));

const DAY_MS = 86_400_000;

/**
 * An Excel date serial as milliseconds since 1970-01-01 UTC, without going through the local time zone. The
 * 1900 system counts a 29 February 1900 that never was, so serials before it are a day off.
 */
export function serialToMs(serial: number, date1904 = false): number {
  const days = date1904 ? serial - 24107 : serial < 61 ? serial - 25568 : serial - 25569;
  return Math.round(days * DAY_MS);
}

function cellMs(cell: XLSX.CellObject, date1904: boolean): number | null {
  if (cell.v instanceof Date) return cell.v.getTime();
  if (typeof cell.v === 'number') return serialToMs(cell.v, date1904);
  const t = Date.parse(String(cell.v));
  return Number.isNaN(t) ? null : t;
}

/** A cell as text: strings as written, anything else as Excel shows it. */
function cellText(cell: XLSX.CellObject): string {
  if (cell.t === 's') return String(cell.v);
  if (cell.w != null) return cell.w;
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  return String(cell.v);
}

type Kind = 'number' | 'date' | 'boolean' | 'text';
const kindOf = (cell: XLSX.CellObject): Kind => (cell.t === 'b' ? 'boolean' : isDateCell(cell) ? 'date' : cell.t === 'n' ? 'number' : 'text');

/** Give one column its type: one kind of value keeps it, mixed kinds become text as Excel shows them. */
function typeColumn(name: string, cells: (XLSX.CellObject | undefined)[], date1904: boolean): SheetColumn {
  const kinds = new Set<Kind>();
  for (const cell of cells) if (!isEmpty(cell)) kinds.add(kindOf(cell!));
  const only = kinds.size === 1 ? [...kinds][0] : kinds.size === 0 ? 'text' : 'mixed';
  const present = (f: (cell: XLSX.CellObject) => number | string | boolean | null) => cells.map((cell) => (isEmpty(cell) ? null : f(cell!)));
  switch (only) {
    case 'number': {
      const values = present((cell) => cell.v as number);
      const whole = values.every((v) => v == null || Number.isSafeInteger(v));
      return { name, type: whole ? 'BIGINT' : 'DOUBLE', values };
    }
    case 'date': {
      const ms = present((cell) => cellMs(cell, date1904));
      const dateOnly = ms.every((v) => v == null || (v as number) % DAY_MS === 0);
      return dateOnly ? { name, type: 'DATE', values: ms.map((v) => (v == null ? null : (v as number) / DAY_MS)) } : { name, type: 'TIMESTAMP', values: ms };
    }
    case 'boolean':
      return { name, type: 'BOOLEAN', values: present((cell) => Boolean(cell.v)) };
    default:
      return { name, type: 'VARCHAR', values: present(cellText) };
  }
}

/**
 * The header row when none is set: the first of the opening 20 rows filled in at least half as wide as the widest
 * of them. Title rows (one cell, often merged across) and blank rows above the header are skipped this way.
 */
export function guessHeaderRow(filled: number[]): number {
  const widest = Math.max(0, ...filled);
  // One cell on its own (a heading over a two-column table) is never the header when wider rows follow.
  const least = Math.max(Math.ceil(widest / 2), widest > 1 ? 2 : 1);
  const i = filled.findIndex((n) => n >= least);
  return Math.max(i, 0);
}

type CellAt = (r: number, c: number) => XLSX.CellObject | undefined;

/**
 * The tables on a sheet: blocks of filled rows with blank rows between them, each trimmed to its filled columns.
 * A block under another is part of the same table when it starts at the same column and is at least half as wide
 * (groups of rows with a blank row between them), one-column blocks only with one-column blocks; a narrower one (a
 * title, footnotes) is a table of its own. A
 * block is split at a blank column only where both sides are at least two columns wide (two tables side by side),
 * so a notes column after a spacer column stays with its table. Where any table is two columns or wider, one-column
 * blocks (a title, a subtitle) aren't tables.
 */
export function findTables(range: CellRange, at: CellAt): CellRange[] {
  // Each row's filled columns.
  const spans: ({ min: number; max: number } | undefined)[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    let min = -1;
    let max = -1;
    for (let c = range.s.c; c <= range.e.c; c++)
      if (!isEmpty(at(r, c))) {
        if (min < 0) min = c;
        max = c;
      }
    spans.push(min < 0 ? undefined : { min, max });
  }
  // Blocks of consecutive filled rows, joined with the block above when they are the same table's groups.
  const blocks: CellRange[] = [];
  let open: CellRange | undefined;
  spans.forEach((span, i) => {
    const r = range.s.r + i;
    if (!span) {
      open = undefined;
      return;
    }
    if (open) {
      open.e.r = r;
      open.s.c = Math.min(open.s.c, span.min);
      open.e.c = Math.max(open.e.c, span.max);
      return;
    }
    const prev = blocks[blocks.length - 1];
    const width = span.max - span.min + 1;
    const prevWidth = prev ? prev.e.c - prev.s.c + 1 : 0;
    const alike = Math.min(width, prevWidth) === 1 ? width === prevWidth : Math.min(width, prevWidth) * 2 >= Math.max(width, prevWidth);
    if (prev && prev.s.c === span.min && alike) {
      open = prev;
      open.e.r = r;
      open.e.c = Math.max(open.e.c, span.max);
      return;
    }
    open = { s: { r, c: span.min }, e: { r, c: span.max } };
    blocks.push(open);
  });
  // Split each block at blank columns, where both sides are tables of their own.
  const tables: CellRange[] = [];
  for (const block of blocks) {
    const filled: boolean[] = [];
    for (let c = block.s.c; c <= block.e.c; c++) {
      let any = false;
      for (let r = block.s.r; r <= block.e.r && !any; r++) if (!isEmpty(at(r, c))) any = true;
      filled.push(any);
    }
    const runs: { s: number; e: number }[] = [];
    filled.forEach((f, i) => {
      if (!f) return;
      const c = block.s.c + i;
      const last = runs[runs.length - 1];
      if (last && last.e === c - 1) last.e = c;
      else runs.push({ s: c, e: c });
    });
    const joined: { s: number; e: number }[] = [];
    for (const run of runs) {
      const last = joined[joined.length - 1];
      if (last && (last.e - last.s < 1 || run.e - run.s < 1)) last.e = run.e;
      else joined.push({ ...run });
    }
    for (const run of joined) tables.push({ s: { r: block.s.r, c: run.s }, e: { r: block.e.r, c: run.e } });
  }
  const wide = tables.filter((t) => t.e.c > t.s.c);
  return wide.length ? wide : tables;
}

/** A table's size: its rows and columns, and how many of its cells are filled. */
function tableInfo(range: CellRange, at: CellAt): SheetTable {
  let cells = 0;
  for (let r = range.s.r; r <= range.e.r; r++) for (let c = range.s.c; c <= range.e.c; c++) if (!isEmpty(at(r, c))) cells++;
  return { range: formatRange(range), rows: range.e.r - range.s.r + 1, columns: range.e.c - range.s.c + 1, cells };
}

/** The merges on a row that span two or more columns of the range. */
const spansOn = (merges: CellRange[], range: CellRange, r: number) => merges.filter((m) => m.s.r === r && m.e.c > m.s.c && m.s.c <= range.e.c && m.e.c >= range.s.c);

/**
 * How many rows the header takes, when not set: a row under the header whose cells beneath the header's merged
 * cells ("Q1" over three months) are text, and whose other cells are empty or merged down from the header, is a
 * second (or third) header row. The other way round, a row above the detected header with merged cells over it and
 * nothing else is the first header row, and the detected one the second.
 */
export function findHeaderRows(range: CellRange, header: number, at: CellAt, merges: CellRange[]): { header: number; rows: number } {
  const inRange = (r: number) => r >= range.s.r && r <= range.e.r;
  const textCell = (cell: XLSX.CellObject | undefined) => !isEmpty(cell) && cell!.t === 's';
  const under = (r: number, prev: number): boolean => {
    const spans = spansOn(merges, range, prev);
    if (!spans.length) return false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = at(r, c);
      if (spans.some((m) => m.s.c <= c && c <= m.e.c)) {
        if (!textCell(cell)) return false;
      } else if (!isEmpty(cell) || !merges.some((m) => m.s.r <= prev && m.e.r >= r && m.s.c <= c && c <= m.e.c)) {
        if (!isEmpty(cell)) return false;
      }
    }
    return true;
  };
  const above = (r: number): boolean => {
    const spans = spansOn(merges, range, r);
    if (!spans.length) return false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (spans.some((m) => m.s.c <= c && c <= m.e.c) || isEmpty(at(r, c))) continue;
      // A name merged down over both rows ("Region") belongs to the header.
      if (!merges.some((m) => m.s.r === r && m.e.r > r && m.s.c <= c && c <= m.e.c)) return false;
    }
    return true;
  };
  let first = header;
  let rows = 1;
  if (inRange(header - 1) && above(header - 1)) {
    first = header - 1;
    rows = 2;
  }
  while (rows < 3 && inRange(first + rows) && under(first + rows, first + rows - 1)) rows++;
  return { header: first, rows };
}

/** Make names unique the way DuckDB compares them (ignoring case): "Q1", "Q1_2", "Q1_3". */
function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((base) => {
    let name = base;
    for (let k = 2; seen.has(name.toLowerCase()); k++) name = `${base}_${k}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

/** The cells actually filled within a range: trailing empty rows and columns are dropped. */
function trimToData(range: CellRange, at: (r: number, c: number) => XLSX.CellObject | undefined): CellRange | undefined {
  let lastR = -1;
  let lastC = -1;
  for (let r = range.s.r; r <= range.e.r; r++)
    for (let c = range.s.c; c <= range.e.c; c++)
      if (!isEmpty(at(r, c))) {
        lastR = r;
        if (c > lastC) lastC = c;
      }
  if (lastR < 0) return undefined;
  return { s: range.s, e: { r: lastR, c: lastC } };
}

/**
 * Read one sheet into typed columns: the chosen sheet (else the first), within the chosen range (else the used
 * range), with names from the header row (else detected). Merged and empty header cells get generated names.
 */
export function readSheet(wb: XLSX.WorkBook, options: SheetReadOptions = {}): SheetData {
  const sheet = options.sheet ?? wb.SheetNames[0];
  const ws = sheet != null ? wb.Sheets[sheet] : undefined;
  if (sheet == null || !ws) throw new ExcelError(sheet == null ? 'This workbook has no sheets.' : `This workbook has no sheet called “${sheet}”. Choose another sheet.`);
  const used = usedRange(ws);
  if (!used) throw new ExcelError(`The sheet “${sheet}” is empty. Choose another sheet.`);
  const at = cellGetter(ws);
  const whole = trimToData(used, at);
  if (!whole) throw new ExcelError(`The sheet “${sheet}” is empty. Choose another sheet.`);
  // The tables on the sheet, largest first; without a chosen range the largest is read (the one the header row is in, when that is set).
  const found = findTables(whole, at).map((r) => ({ cells: r, info: tableInfo(r, at) }));
  found.sort((a, b) => b.info.cells - a.info.cells || a.cells.s.r - b.cells.s.r);
  const tables = found.map((t) => t.info);

  let range: CellRange;
  if (options.range) {
    const wanted = parseRange(options.range);
    if (!wanted) throw new ExcelError(`“${options.range}” isn’t a cell range. Write it like A1:F200.`);
    const both = intersect(used, wanted);
    const data = both && trimToData(both, at);
    if (!both) throw new ExcelError(`The range ${options.range.toUpperCase()} has no data in the sheet “${sheet}”, whose data is in ${formatRange(used)}.`);
    if (!data) throw new ExcelError(`The range ${options.range.toUpperCase()} is empty in the sheet “${sheet}”.`);
    range = data;
  } else {
    const wantedHeader = options.headerRow != null && options.headerRow > 0 ? options.headerRow - 1 : undefined;
    const holding = wantedHeader == null ? found[0] : found.find((t) => t.cells.s.r <= wantedHeader && wantedHeader <= t.cells.e.r);
    range = holding?.cells ?? whole;
  }

  // Header row as a 0-based sheet row, or -1 for none.
  let header: number;
  if (options.headerRow === 0) header = -1;
  else if (options.headerRow != null) {
    header = options.headerRow - 1;
    if (header < range.s.r || header > range.e.r)
      throw new ExcelError(`Row ${options.headerRow} is outside the data read (${formatRange(range)}). Choose a header row from ${range.s.r + 1} to ${range.e.r + 1}.`);
  } else {
    const filled: number[] = [];
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 19); r++) {
      let n = 0;
      for (let c = range.s.c; c <= range.e.c; c++) if (!isEmpty(at(r, c))) n++;
      filled.push(n);
    }
    header = range.s.r + guessHeaderRow(filled);
  }

  const merges = (ws['!merges'] ?? []) as CellRange[];
  // How many rows the header takes: as set (1 to 3), else found from the merges.
  let headerRows = 0;
  if (header >= 0) {
    if (options.headerRows != null) {
      headerRows = Math.min(3, Math.max(1, Math.floor(options.headerRows)));
      if (header + headerRows - 1 > range.e.r) throw new ExcelError(`The header can’t be ${headerRows} rows from row ${header + 1}: the data read (${formatRange(range)}) ends at row ${range.e.r + 1}.`);
    } else if (options.headerRow != null) headerRows = 1;
    else ({ header, rows: headerRows } = findHeaderRows(range, header, at, merges));
  }
  const lastHeader = header >= 0 ? header + headerRows - 1 : -1;

  /** A header cell's text: its own, or the merged cell's it sits in when that starts in the header. */
  const headerText = (r: number, c: number): string => {
    const own = at(r, c);
    if (!isEmpty(own)) return cellText(own!).trim();
    const m = merges.find((g) => g.s.r <= r && r <= g.e.r && g.s.c <= c && c <= g.e.c);
    const top = m ? at(m.s.r, m.s.c) : undefined;
    return !isEmpty(top) ? cellText(top!).trim() : '';
  };
  // The parts of a name down the header rows, a merged cell's once ("Region" over two rows), joined: "Q1 Jan".
  const headerName = (c: number): string => {
    const parts: string[] = [];
    for (let r = header; r <= lastHeader; r++) {
      const t = headerText(r, c);
      if (t && parts[parts.length - 1] !== t) parts.push(t);
    }
    return parts.join(' ') || `Column ${columnLetters(c)}`;
  };

  const first = header >= 0 ? lastHeader + 1 : range.s.r;
  // Merged cells in the data: every cell of a merge takes the merged cell's value, unless told not to.
  const fill = new Map<string, XLSX.CellObject>();
  let merged = 0;
  for (const m of merges) {
    if (m.s.r < first || m.s.r > range.e.r || m.e.c < range.s.c || m.s.c > range.e.c || (m.s.r === m.e.r && m.s.c === m.e.c)) continue;
    const top = at(m.s.r, m.s.c);
    if (isEmpty(top)) continue;
    merged++;
    if (options.fillMerges === false) continue;
    for (let r = m.s.r; r <= Math.min(m.e.r, range.e.r); r++) for (let c = Math.max(m.s.c, range.s.c); c <= Math.min(m.e.c, range.e.c); c++) if (r !== m.s.r || c !== m.s.c) fill.set(`${r},${c}`, top!);
  }
  const cellAt: CellAt = fill.size ? (r, c) => at(r, c) ?? fill.get(`${r},${c}`) : at;

  const columns: SheetColumn[] = [];
  const names: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) names.push(header >= 0 ? headerName(c) : `Column ${columnLetters(c)}`);
  const unique = uniqueNames(names);
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cells: (XLSX.CellObject | undefined)[] = [];
    for (let r = first; r <= range.e.r; r++) cells.push(cellAt(r, c));
    columns.push(typeColumn(unique[c - range.s.c]!, cells, date1904));
  }
  return { sheet, headerRow: header + 1, headerRows, range: formatRange(range), columns, rows: Math.max(0, range.e.r - first + 1), merges: merged, tables };
}
