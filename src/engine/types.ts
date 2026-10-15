import type { Table } from 'apache-arrow';

/** Preview queries run first; profiling and rule queries wait behind them and yield to them. */
export type Priority = 'preview' | 'background';

export type BundleName = 'mvp' | 'eh' | 'coi';

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
}

export interface EngineInfo {
  bundle: BundleName;
  version: string;
  /** True when DuckDB can spill temporary data to the Origin Private File System. */
  spill: boolean;
  crossOriginIsolated: boolean;
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
  /** Register small in-memory content (clipboard text, fixtures). */
  registerBuffer(name: string, data: Uint8Array): Promise<void>;
  dropFile(name: string): Promise<void>;
  close(): Promise<void>;
}
