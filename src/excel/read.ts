// Reading .xlsx workbooks with SheetJS into typed columns. Runs in the Excel worker (src/excel/worker.ts), and
// directly in tests.
import * as XLSX from 'xlsx';
import { columnLetters, formatRange, intersect, parseRange, type CellRange } from './range';
import { ExcelError, type SheetColumn, type SheetData, type SheetInfo, type SheetReadOptions } from './types';

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0];
const startsWith = (data: Uint8Array, magic: number[]) => magic.every((b, i) => data[i] === b);

/**
 * Parse a workbook's bytes. Only .xlsx (a zip) is read: SheetJS would otherwise happily read any text as a CSV,
 * and the old binary format (an OLE file, also how password-protected workbooks are stored) is refused in plain words.
 */
export function parseWorkbook(data: Uint8Array): XLSX.WorkBook {
  if (startsWith(data, OLE))
    throw new ExcelError('This workbook is in the old .xls format or is password-protected. Remove any password, save it as .xlsx or CSV, and add it again.');
  if (!startsWith(data, ZIP)) throw new ExcelError('This file isn’t an Excel workbook. Save it from Excel as .xlsx, or add it as a CSV.');
  try {
    // Dense sheets use less memory; number formats (cellNF) tell dates from numbers.
    return XLSX.read(data, { type: 'array', dense: true, cellNF: true, cellDates: false, cellHTML: false, cellFormula: false });
  } catch (e) {
    throw new ExcelError(`This workbook can’t be read (${e instanceof Error ? e.message : String(e)}). Open it in Excel, save it again as .xlsx, and add it again.`);
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
  const i = filled.findIndex((n) => n > 0 && n >= Math.ceil(widest / 2));
  return Math.max(i, 0);
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

  let range = used;
  if (options.range) {
    const wanted = parseRange(options.range);
    if (!wanted) throw new ExcelError(`“${options.range}” isn’t a cell range. Write it like A1:F200.`);
    const both = intersect(used, wanted);
    if (!both) throw new ExcelError(`The range ${options.range.toUpperCase()} has no data in the sheet “${sheet}”, whose data is in ${formatRange(used)}.`);
    range = both;
  }
  const at = cellGetter(ws);
  const data = trimToData(range, at);
  if (!data) throw new ExcelError(options.range ? `The range ${options.range.toUpperCase()} is empty in the sheet “${sheet}”.` : `The sheet “${sheet}” is empty. Choose another sheet.`);
  range = data;

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
  const headerName = (c: number): string => {
    const own = at(header, c);
    if (!isEmpty(own)) return cellText(own!).trim() || `Column ${columnLetters(c)}`;
    // An empty cell inside a merge takes the merged cell's name; uniqueNames numbers the repeats.
    const m = merges.find((g) => g.s.r <= header && header <= g.e.r && g.s.c <= c && c <= g.e.c);
    const top = m ? at(m.s.r, m.s.c) : undefined;
    return !isEmpty(top) ? cellText(top!).trim() || `Column ${columnLetters(c)}` : `Column ${columnLetters(c)}`;
  };

  const first = header >= 0 ? header + 1 : range.s.r;
  const columns: SheetColumn[] = [];
  const names: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) names.push(header >= 0 ? headerName(c) : `Column ${columnLetters(c)}`);
  const unique = uniqueNames(names);
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cells: (XLSX.CellObject | undefined)[] = [];
    for (let r = first; r <= range.e.r; r++) cells.push(at(r, c));
    columns.push(typeColumn(unique[c - range.s.c]!, cells, date1904));
  }
  return { sheet, headerRow: header + 1, range: formatRange(range), columns, rows: Math.max(0, range.e.r - first + 1) };
}
