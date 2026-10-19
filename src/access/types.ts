// Shapes shared by the Access worker and the main thread. Nothing here imports mdb-reader.
import type { SheetColumn } from '../excel/types';

/** A table in an Access database and its size. */
export interface AccessTableInfo {
  name: string;
  rows: number;
  columns: number;
}

/**
 * One column of an Access table: its values as they cross to DuckDB in Arrow (`type`, see src/excel/arrow.ts), and
 * the DuckDB type the loaded table gives it (`sqlType`), such as DECIMAL(19,4) for Currency, which arrives as text.
 */
export interface AccessColumn extends SheetColumn {
  sqlType: string;
}

/** A plain-words failure reading a database, safe to show as it is. */
export class AccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessError';
  }
}

/** What to say about a database encrypted with a password, which Puddle can't open. */
export const ENCRYPTED =
  'This database is encrypted with a password, which Puddle can’t open. In Access, remove the password (File › Info › Decrypt Database), save it, and add it again.';
