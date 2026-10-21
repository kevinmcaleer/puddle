// What the SQLite worker does, as plain methods: the worker (worker.ts) calls them, and tests and the runner call them directly.
import type { Database } from 'sql.js';
import { sheetToIPC } from '../excel/arrow';
import { describeTables, listTables, openDatabase, readRows } from './read';
import { SqliteError, type SqliteTableDetail, type SqliteTableInfo } from './types';

export interface SqliteReadResult {
  rows: number;
  /** Each column's name and the DuckDB type the loaded table gives it. */
  columns: { name: string; sqlType: string }[];
  /** The rows as an Arrow IPC stream, for DuckDB. */
  ipc: Uint8Array;
}

/** Every operation the worker answers: its arguments and its result. */
export interface SqliteOps {
  /** The tables of a database. `db` names it so it is opened once across calls. */
  tables: { args: { db: string; file: Blob }; result: SqliteTableInfo[] };
  /** The tables in detail, for documenting the schema. */
  describe: { args: { db: string; file: Blob }; result: SqliteTableDetail[] };
  /** Read a table or run a query, at most `limit` rows. */
  read: { args: { db: string; file: Blob; table?: string; query?: string; limit?: number }; result: SqliteReadResult };
  /** Let an opened database go. */
  forget: { args: { db: string }; result: void };
}

export type SqliteOp = keyof SqliteOps;

/** Opened databases are kept for other reads; only the most recent few, as each is held whole in memory. */
const KEEP = 2;

export class SqliteService implements Record<SqliteOp, (args: never) => Promise<unknown>> {
  private readonly dbs = new Map<string, Database>();

  constructor(private readonly locateFile?: (file: string) => string) {}

  private async database(db: string, file: Blob): Promise<Database> {
    let open = this.dbs.get(db);
    if (open) this.dbs.delete(db);
    else open = await openDatabase(new Uint8Array(await file.arrayBuffer()), this.locateFile);
    this.dbs.set(db, open);
    while (this.dbs.size > KEEP) {
      const oldest = this.dbs.keys().next().value!;
      this.dbs.get(oldest)?.close();
      this.dbs.delete(oldest);
    }
    return open;
  }

  async tables({ db, file }: SqliteOps['tables']['args']): Promise<SqliteTableInfo[]> {
    return listTables(await this.database(db, file));
  }

  async describe({ db, file }: SqliteOps['describe']['args']): Promise<SqliteTableDetail[]> {
    return describeTables(await this.database(db, file));
  }

  async read({ db, file, table, query, limit }: SqliteOps['read']['args']): Promise<SqliteReadResult> {
    if (!table && !query) throw new SqliteError('Choose a table or write a query.');
    const data = readRows(await this.database(db, file), table ? { table } : { query: query! }, limit);
    return { rows: data.rows, columns: data.columns.map((c) => ({ name: c.name, sqlType: c.sqlType })), ipc: sheetToIPC(data.columns) };
  }

  async forget({ db }: SqliteOps['forget']['args']): Promise<void> {
    this.dbs.get(db)?.close();
    this.dbs.delete(db);
  }

  /** Run an operation by name; failures come back as SqliteError with a message fit to show. */
  async run<K extends SqliteOp>(op: K, args: SqliteOps[K]['args']): Promise<SqliteOps[K]['result']> {
    try {
      return (await (this[op] as (a: SqliteOps[K]['args']) => Promise<SqliteOps[K]['result']>).call(this, args)) as SqliteOps[K]['result'];
    } catch (e) {
      if (e instanceof SqliteError) throw e;
      throw new SqliteError(`This database can’t be read (${e instanceof Error ? e.message : String(e)}).`);
    }
  }
}
