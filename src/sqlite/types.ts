// Shapes shared by the SQLite worker and the main thread. Nothing here imports sql.js.
import type { SheetColumn } from '../excel/types';

export class SqliteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqliteError';
  }
}

/** A table or view of the database, with its columns as declared. */
export interface SqliteTableInfo {
  name: string;
  kind: 'table' | 'view';
  columns: { name: string; type: string; pk: boolean; notNull: boolean }[];
  rows: number;
}

/** A column read, with the DuckDB type it is loaded as. */
export interface SqliteColumn extends SheetColumn {
  sqlType: string;
}

export interface SqliteData {
  columns: SqliteColumn[];
  rows: number;
}
