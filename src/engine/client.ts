import type { Table } from 'apache-arrow';
import { disableOptimizers } from '../compiler/sql';
import { EngineError, toEngineError } from './errors';
import { Scheduler } from './scheduler';
import type { Activity, ColumnSchema, DuckBackend, EngineInfo, OutputFile, QueryOptions, QueryResult } from './types';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Arrow type names to DuckDB names, for result columns. DESCRIBE gives exact DuckDB types when needed. */
function arrowTypeToDuck(t: string): string {
  if (/^Utf8|^LargeUtf8/.test(t)) return 'VARCHAR';
  if (t === 'Int8') return 'TINYINT';
  if (t === 'Int16') return 'SMALLINT';
  if (t === 'Int32') return 'INTEGER';
  if (t === 'Int64') return 'BIGINT';
  if (/^Uint/.test(t)) return 'UBIGINT';
  if (/^Float16|^Float32/.test(t)) return 'FLOAT';
  if (/^Float64/.test(t)) return 'DOUBLE';
  if (/^Decimal/.test(t)) return 'DECIMAL';
  if (t === 'Bool') return 'BOOLEAN';
  if (/^Date/.test(t)) return 'DATE';
  if (/^Timestamp/.test(t)) return 'TIMESTAMP';
  if (/^Time/.test(t)) return 'TIME';
  if (/^Struct/.test(t)) return 'STRUCT';
  if (/^List/.test(t)) return 'LIST';
  return t.toUpperCase();
}

export function tableColumns(table: Table): ColumnSchema[] {
  return table.schema.fields.map((f) => ({ name: f.name, type: arrowTypeToDuck(String(f.type)) }));
}

/** Convert Arrow rows to plain objects; BIGINTs become numbers when safe and strings otherwise. */
export function tableRows(table: Table): Record<string, unknown>[] {
  return table.toArray().map((row) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row.toJSON() as Record<string, unknown>)) {
      o[k] = typeof v === 'bigint' ? (Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()) : v;
    }
    return o;
  });
}

/**
 * DuckDB optimizers that copy part of a query plan, which DuckDB does by serialising it. A plan reading a CSV file
 * can't be serialised; DuckDB catches that and keeps the plan as it is, but in Safari (WebKit) the failure escapes
 * as the query's error. Queries that read a table more than once (joins, appends, lookups, date detection) hit it.
 */
export const PLAN_COPY_OPTIMIZERS = ['cte_inlining', 'common_subplan'];

/** DuckDB's error when it can't serialise part of a plan, e.g. "CSVReaderSerialize not implemented". */
export const isPlanCopyFailure = (e: unknown) => /\w+Serialize not implemented/.test(e instanceof Error ? e.message : String(e));

/**
 * DuckDB stopped inside a call: a WebAssembly trap ("Unreachable code should not be executed", "access to a null
 * reference"), which the worker passes on as a RuntimeError. It is no fault of the query. Safari (WebKit) does it now
 * and then in the middle of an ordinary query, the way it now and then fails DuckDB's start (src/engine/browser.ts).
 */
export const isEngineTrap = (e: unknown) =>
  e instanceof Error && (e.name === 'RuntimeError' || /^(Unreachable code should not be executed|access to a null reference)\b/i.test(e.message));

/**
 * The main-thread face of the engine. Every call goes through the scheduler, so previews beat background
 * work, superseded previews are cancelled, and errors come back as EngineError.
 */
export class EngineClient {
  private readonly scheduler = new Scheduler();
  private readonly stopListeners = new Set<() => void>();
  /** True once the plan-copying optimizers are off (see PLAN_COPY_OPTIMIZERS): a database setting, so a new connection keeps it. */
  private planCopiesOff = false;

  constructor(private readonly backend: DuckBackend) {}

  get info(): EngineInfo {
    return this.backend.info;
  }

  get pending(): number {
    return this.scheduler.size;
  }

  /** The query running now, for the Stop control. */
  get activity(): Activity | null {
    return this.scheduler.activity;
  }

  onActivity(fn: (a: Activity | null) => void): () => void {
    return this.scheduler.subscribe(fn);
  }

  /** Stop the running query in DuckDB and drop the queued ones; each rejects with an EngineError coded "stopped". */
  stop(): number {
    const n = this.scheduler.stop();
    for (const fn of this.stopListeners) fn();
    return n;
  }

  /** Called on every stop(), for work that queues its queries one at a time (kept results) and should stop too. */
  onStop(fn: () => void): () => void {
    this.stopListeners.add(fn);
    return () => void this.stopListeners.delete(fn);
  }

  query(sql: string, opts: QueryOptions = {}): Promise<QueryResult> {
    return this.scheduler.submit(async (signal) => {
      const t0 = now();
      const table = await this.run(sql, signal);
      return { table, numRows: table.numRows, columns: tableColumns(table), elapsedMs: now() - t0 };
    }, opts);
  }

  /** Column names and DuckDB types of a query's result, without running it over the data. */
  describe(sql: string, opts: QueryOptions = {}): Promise<ColumnSchema[]> {
    return this.scheduler.submit(async (signal) => {
      const table = await this.run(`DESCRIBE ${sql}`, signal);
      return tableRows(table).map((r) => ({ name: String(r.column_name), type: String(r.column_type) }));
    }, { label: 'Reading columns', ...opts });
  }

  /**
   * Run a COPY ... TO into a new output file and return what it wrote: the file and DuckDB's row count.
   * `sql` gets the path to write to. A failed or cancelled write leaves nothing behind.
   */
  async exportFile(name: string, sql: (path: string) => string, opts: QueryOptions = {}): Promise<{ blob: Blob; rows: number }> {
    let out: OutputFile;
    try {
      out = await this.backend.openOutput(name);
    } catch (e) {
      throw toEngineError(e);
    }
    try {
      const r = await this.query(sql(out.path), opts);
      const count = r.table.numRows ? Object.values(r.table.get(0)?.toJSON() ?? {})[0] : 0;
      const blob = await out.finish();
      return { blob, rows: Number(count ?? 0) };
    } catch (e) {
      await out.discard().catch(() => undefined);
      throw toEngineError(e);
    }
  }

  async registerFile(name: string, file: File): Promise<void> {
    await this.wrap(() => this.backend.registerFile(name, file));
  }

  async registerText(name: string, text: string): Promise<void> {
    await this.wrap(() => this.backend.registerBuffer(name, new TextEncoder().encode(text)));
  }

  async registerUrl(name: string, url: string): Promise<void> {
    await this.wrap(() => this.backend.registerUrl(name, url));
  }

  async registerBuffer(name: string, data: Uint8Array): Promise<void> {
    await this.wrap(() => this.backend.registerBuffer(name, data));
  }

  /** Create a table from an Arrow IPC stream. The buffer is handed to DuckDB's worker, so don't reuse it. */
  async insertArrow(name: string, ipc: Uint8Array): Promise<void> {
    await this.wrap(() => this.backend.insertArrow(name, ipc));
  }

  async dropFile(name: string): Promise<void> {
    await this.wrap(() => this.backend.dropFile(name));
  }

  close(): Promise<void> {
    return this.backend.close();
  }

  /**
   * Run a query. If DuckDB stopped inside it (see isEngineTrap), go on with a new connection and run it once more, so
   * a source doesn't break or a result go missing over it; a second stop is shown as the query's error.
   */
  private async run(sql: string, signal: AbortSignal): Promise<Table> {
    try {
      return await this.runOnce(sql, signal);
    } catch (e) {
      if (!isEngineTrap(e) || signal.aborted) throw e;
      console.warn(`DuckDB stopped inside a query (${(e as Error).message.split('\n')[0]}), so it is running it once more on a new connection.`);
      try {
        await this.backend.reconnect();
      } catch {
        throw e;
      }
      return this.runOnce(sql, signal);
    }
  }

  /**
   * Run a query once. If DuckDB fails because it couldn't copy part of the plan (see PLAN_COPY_OPTIMIZERS), turn those
   * optimizers off and run it once more; every later query runs without them too.
   */
  private async runOnce(sql: string, signal: AbortSignal): Promise<Table> {
    try {
      return await this.backend.query(sql, signal);
    } catch (e) {
      if (this.planCopiesOff || !isPlanCopyFailure(e)) throw e;
      try {
        await this.backend.query(disableOptimizers(PLAN_COPY_OPTIMIZERS), signal);
      } catch {
        throw e;
      }
      this.planCopiesOff = true;
      console.warn(`DuckDB couldn't copy a query plan here, so ${PLAN_COPY_OPTIMIZERS.join(' and ')} are now off.`);
      return this.backend.query(sql, signal);
    }
  }

  private async wrap(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      throw toEngineError(e);
    }
  }
}

export { EngineError };
