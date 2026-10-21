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

/** A table or view in detail, for documenting the schema: keys, indexes, foreign keys, defaults, and a view's SQL. */
export interface SqliteTableDetail {
  name: string;
  kind: 'table' | 'view';
  columns: { name: string; type: string; pk: boolean; unique: boolean; notNull: boolean; increment: boolean; default?: string }[];
  indexes: { name: string; columns: string[]; unique: boolean }[];
  foreignKeys: { columns: string[]; refTable: string; refColumns: string[] }[];
  sql?: string;
}

/** A column read, with the DuckDB type it is loaded as. */
export interface SqliteColumn extends SheetColumn {
  sqlType: string;
}

export interface SqliteData {
  columns: SqliteColumn[];
  rows: number;
}
