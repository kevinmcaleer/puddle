// What the Excel worker does, as plain methods: the worker (worker.ts) calls them, and tests call them directly.
import type { WorkBook } from 'xlsx';
import { sheetToIPC } from './arrow';
import { listSheets, parseWorkbook, readSheet } from './read';
import { ExcelError, type SheetColumnType, type SheetInfo, type SheetReadOptions } from './types';

export interface ReadResult {
  sheets: SheetInfo[];
  sheet: string;
  headerRow: number;
  range: string;
  rows: number;
  columns: { name: string; type: SheetColumnType }[];
  /** The sheet as an Arrow IPC stream, for DuckDB. */
  ipc: Uint8Array;
}

/** Every operation the worker answers: its arguments and its result. */
export interface ExcelOps {
  /** Read one sheet of a workbook. `book` names the workbook so it is parsed once, not on every option change. */
  read: { args: { book: string; file: Blob; options: SheetReadOptions }; result: ReadResult };
  /** Let a parsed workbook go. */
  forget: { args: { book: string }; result: void };
}

export type ExcelOp = keyof ExcelOps;

/** Parsed workbooks are kept for re-reads with other options; only the most recent few, as each is held whole in memory. */
const KEEP = 2;

export class ExcelService implements Record<ExcelOp, (args: never) => Promise<unknown>> {
  private readonly books = new Map<string, WorkBook>();

  private async workbook(book: string, file: Blob): Promise<WorkBook> {
    let wb = this.books.get(book);
    if (wb) this.books.delete(book);
    else wb = parseWorkbook(new Uint8Array(await file.arrayBuffer()));
    this.books.set(book, wb);
    while (this.books.size > KEEP) this.books.delete(this.books.keys().next().value!);
    return wb;
  }

  async read({ book, file, options }: ExcelOps['read']['args']): Promise<ReadResult> {
    const wb = await this.workbook(book, file);
    const sheets = listSheets(wb);
    const data = readSheet(wb, options);
    return {
      sheets,
      sheet: data.sheet,
      headerRow: data.headerRow,
      range: data.range,
      rows: data.rows,
      columns: data.columns.map((c) => ({ name: c.name, type: c.type })),
      ipc: sheetToIPC(data.columns),
    };
  }

  async forget({ book }: ExcelOps['forget']['args']): Promise<void> {
    this.books.delete(book);
  }

  /** Run an operation by name; failures come back as ExcelError with a message fit to show. */
  async run<K extends ExcelOp>(op: K, args: ExcelOps[K]['args']): Promise<ExcelOps[K]['result']> {
    try {
      return (await (this[op] as (a: ExcelOps[K]['args']) => Promise<ExcelOps[K]['result']>).call(this, args)) as ExcelOps[K]['result'];
    } catch (e) {
      if (e instanceof ExcelError) throw e;
      throw new ExcelError(`This workbook can’t be read (${e instanceof Error ? e.message : String(e)}).`);
    }
  }
}

/** Buffers in a result that can be handed over to the other thread instead of copied. */
export function transferables(result: unknown): Transferable[] {
  return result && typeof result === 'object' && 'ipc' in result && result.ipc instanceof Uint8Array ? [result.ipc.buffer as ArrayBuffer] : [];
}
