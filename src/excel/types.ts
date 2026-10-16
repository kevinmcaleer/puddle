// Shapes shared by the SheetJS worker and the main thread. Nothing here imports SheetJS.

/** The DuckDB type a sheet column is given. */
export type SheetColumnType = 'BIGINT' | 'DOUBLE' | 'DATE' | 'TIMESTAMP' | 'BOOLEAN' | 'VARCHAR';

/** A sheet in a workbook and the size of its used range. */
export interface SheetInfo {
  name: string;
  rows: number;
  columns: number;
}

/** How to read a sheet. Unset fields mean: the first sheet, detect the header row, the whole used range. */
export interface SheetReadOptions {
  sheet?: string;
  /** Row number in the sheet (1 is the first row); 0 means the sheet has no header row. */
  headerRow?: number;
  /** An A1 range such as "B3:F200", or one cell meaning from there on. */
  range?: string;
}

/**
 * One column of a sheet. Values are plain numbers for BIGINT, DOUBLE, DATE (days since 1970-01-01) and
 * TIMESTAMP (milliseconds since 1970-01-01, UTC), so they cross to and from the worker cheaply.
 */
export interface SheetColumn {
  name: string;
  type: SheetColumnType;
  values: (number | string | boolean | null)[];
}

export interface SheetData {
  sheet: string;
  /** The header row used (1-based sheet row), or 0 for none. */
  headerRow: number;
  /** The cells read, as an A1 range. */
  range: string;
  columns: SheetColumn[];
  rows: number;
}

/** A plain-words failure reading a workbook, safe to show as it is. */
export class ExcelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExcelError';
  }
}
