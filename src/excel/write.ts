// Writing .xlsx workbooks with SheetJS from Arrow record batches. Runs in the Excel worker (src/excel/worker.ts),
// and directly in tests.
import { DataType, RecordBatchReader, type Field, type Vector } from 'apache-arrow';
import * as XLSX from 'xlsx';
import { SHEET_COLUMNS, SHEET_ROWS, sheetNameProblem, tooManyRows } from './limits';
import { ExcelError } from './types';

export interface SheetWriteOptions {
  sheetName: string;
  header: boolean;
  /** Keep the header row in view while scrolling. Ignored without a header. */
  freezeHeader: boolean;
}

const DAY_MS = 86_400_000;
/** Milliseconds since 1970-01-01 UTC as an Excel date serial (1900 system), with no time zone involved. */
export const msToSerial = (ms: number) => ms / DAY_MS + 25569;

type CellFor = (value: unknown) => XLSX.CellObject | undefined;

/** How each Arrow column type becomes a cell: numbers, booleans, dates and text keep their types. */
function cellMaker(field: Field): CellFor {
  const t = field.type;
  if (DataType.isBool(t)) return (v) => ({ t: 'b', v: Boolean(v) });
  if (DataType.isInt(t))
    return (v) => {
      const n = typeof v === 'bigint' ? Number(v) : (v as number);
      // Beyond 2^53 a number loses digits in Excel, so very large integers (ids, mostly) are written as text.
      return Number.isSafeInteger(n) ? { t: 'n', v: n } : { t: 's', v: String(v) };
    };
  if (DataType.isFloat(t))
    return (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? { t: 'n', v: n } : { t: 's', v: String(n) };
    };
  if (DataType.isDate(t)) return (v) => ({ t: 'n', v: msToSerial(Number(v instanceof Date ? v.getTime() : v)), z: 'yyyy-mm-dd' });
  if (DataType.isTimestamp(t)) return (v) => ({ t: 'n', v: msToSerial(Number(v instanceof Date ? v.getTime() : v)), z: 'yyyy-mm-dd hh:mm:ss' });
  return (v) => ({ t: 's', v: String(v) });
}

const FROZEN_HEADER = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>';

/**
 * Freeze the first row. SheetJS's community edition doesn't write panes, so the written sheet's view is edited
 * in the zip: an empty <sheetView .../> gets a frozen pane below row 1.
 */
function freezeFirstRow(book: Uint8Array): Uint8Array {
  const zip = XLSX.CFB.read(book, { type: 'array' });
  const entry = XLSX.CFB.find(zip, '/xl/worksheets/sheet1.xml') as { content: Uint8Array } | null;
  if (!entry) return book;
  const xml = new TextDecoder().decode(entry.content);
  const frozen = xml.replace(/<sheetView([^>]*?)\/>/, `<sheetView$1>${FROZEN_HEADER}</sheetView>`);
  if (frozen === xml) return book;
  entry.content = new TextEncoder().encode(frozen);
  return new Uint8Array(XLSX.CFB.write(zip, { fileType: 'zip', type: 'array', compression: true }) as ArrayBuffer);
}

/**
 * A one-sheet workbook from an Arrow IPC stream, read batch by batch. Refuses, in plain words, more rows or
 * columns than a sheet holds rather than cutting them off.
 */
export function writeWorkbook(ipc: Uint8Array, options: SheetWriteOptions): Uint8Array {
  const problem = sheetNameProblem(options.sheetName);
  if (problem) throw new ExcelError(problem);
  const reader = RecordBatchReader.from(ipc);
  reader.open();
  const fields = reader.schema.fields;
  if (fields.length > SHEET_COLUMNS) throw new ExcelError(`This output has ${fields.length.toLocaleString('en-GB')} columns; an Excel sheet holds at most ${SHEET_COLUMNS.toLocaleString('en-GB')}. Export it as CSV or Parquet instead.`);
  const makers = fields.map(cellMaker);
  const data: XLSX.CellObject[][] = [];
  if (options.header) data.push(fields.map((f) => ({ t: 's', v: f.name })));
  const room = SHEET_ROWS - data.length;
  let rows = 0;
  for (const batch of reader) {
    rows += batch.numRows;
    if (rows > room) throw new ExcelError(tooManyRows(rows, options.header));
    const columns = fields.map((_, i) => batch.getChildAt(i) as Vector);
    for (let r = 0; r < batch.numRows; r++) {
      const row: XLSX.CellObject[] = [];
      for (let c = 0; c < columns.length; c++) {
        const v = columns[c]!.get(r);
        const cell = v == null ? undefined : makers[c]!(v);
        if (cell) row[c] = cell;
      }
      data.push(row);
    }
  }
  const ws: XLSX.WorkSheet = { '!data': data } as XLSX.WorkSheet;
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(data.length - 1, 0), c: Math.max(fields.length - 1, 0) } });
  // Column widths from the header and the first rows, so dates and names aren't shown as ####.
  ws['!cols'] = fields.map((f, c) => {
    let width = options.header ? f.name.length : 4;
    for (let r = 0; r < Math.min(data.length, 200); r++) {
      const cell = data[r]?.[c];
      if (cell) width = Math.max(width, cell.z === 'yyyy-mm-dd' ? 10 : cell.z ? 19 : String(cell.v).length);
    }
    return { wch: Math.min(Math.max(width + 2, 6), 60) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, options.sheetName);
  const book = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer);
  return options.header && options.freezeHeader && data.length > 1 ? freezeFirstRow(book) : book;
}
