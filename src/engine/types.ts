import type { Table } from 'apache-arrow';

/** Preview queries run first; profiling and rule queries wait behind them and yield to them. */
export type Priority = 'preview' | 'background';

export type BundleName = 'mvp' | 'eh';

export interface ColumnSchema {
  name: string;
  /** DuckDB type name, e.g. VARCHAR, BIGINT, DATE. */
  type: string;
}

export interface QueryResult {
  table: Table;
  numRows: number;
  columns: ColumnSchema[];
  elapsedMs: number;
}

export interface QueryOptions {
  priority?: Priority;
  /** Cancellation token. Aborting rejects the call with an EngineError of code "cancelled". */
  signal?: AbortSignal;
  /**
   * Jobs sharing a supersede key replace each other: starting a new one cancels the previous one,
   * whether it is still queued or already running. The preview pane uses "preview".
   */
  supersede?: string;
  /** What the query is doing, in a few words ("Counting rows"), for the Stop control. */
  label?: string;
}

/** The query DuckDB is running now, for the Stop control. */
export interface Activity {
  label: string;
  priority: Priority;
  /** Date.now() when it started running. */
  startedAt: number;
}

export interface EngineInfo {
  bundle: BundleName;
  version: string;
  /** True when DuckDB can spill temporary data to the Origin Private File System. */
  spill: boolean;
  crossOriginIsolated: boolean;
  /** Where DuckDB loads json and parquet from: this site's own copy, or extensions.duckdb.org. */
  extensions?: string;
}

/**
 * What the engine client needs from DuckDB. In the browser this is AsyncDuckDB, which runs DuckDB-WASM
 * in its own Web Worker; tests use the blocking Node build of the same WASM.
 */
export interface DuckBackend {
  readonly info: EngineInfo;
  query(sql: string, signal: AbortSignal): Promise<Table>;
  /** Register a File so DuckDB reads it by byte range, never copying it into JS memory. */
  registerFile(name: string, file: File): Promise<void>;
  /** Register a web address DuckDB reads by HTTP range requests (the server must allow them and CORS). */
  registerUrl(name: string, url: string): Promise<void>;
  /** Register small in-memory content (clipboard text, fixtures). */
  registerBuffer(name: string, data: Uint8Array): Promise<void>;
  dropFile(name: string): Promise<void>;
  /** Create table `name` from an Arrow IPC stream (Excel sheets read by SheetJS). The table must not exist yet. */
  insertArrow(name: string, ipc: Uint8Array): Promise<void>;
  /** A file for COPY ... TO to write into, handed back as a Blob once written. */
  openOutput(name: string): Promise<OutputFile>;
  /**
   * Go on with a new connection to the same database, for after DuckDB stopped inside a query on this one (see
   * isEngineTrap). Tables, registered files and settings belong to the database, so they carry over.
   */
  reconnect(): Promise<void>;
  close(): Promise<void>;
}

/** Where an export is written: DuckDB's in-memory file system in the browser, a temp folder in Node tests. */
export interface OutputFile {
  /** The path to give COPY ... TO. */
  path: string;
  /** Close the file and return its contents. */
  finish(): Promise<Blob>;
  /** Close and remove the file after a failed write. */
  discard(): Promise<void>;
}
