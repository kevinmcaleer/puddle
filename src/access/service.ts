// What the Access worker does, as plain methods: the worker (worker.ts) calls them, and tests call them directly.
import type MDBReader from 'mdb-reader';
import { sheetToIPC } from '../excel/arrow';
import { listTables, openDatabase, readTable } from './read';
import { AccessError, type AccessTableInfo } from './types';

export interface AccessReadResult {
  tables: AccessTableInfo[];
  table: string;
  rows: number;
  /** Each column's name and the DuckDB type the loaded table gives it. */
  columns: { name: string; sqlType: string }[];
  /** The table as an Arrow IPC stream, for DuckDB. */
  ipc: Uint8Array;
}

/** Every operation the worker answers: its arguments and its result. */
export interface AccessOps {
  /** Read one table of a database. `db` names the database so it is opened once, not on every change of table. */
  read: { args: { db: string; file: Blob; table?: string }; result: AccessReadResult };
  /** Let an opened database go. */
  forget: { args: { db: string }; result: void };
}

export type AccessOp = keyof AccessOps;

/** Opened databases are kept for reading other tables; only the most recent few, as each is held whole in memory. */
const KEEP = 2;

export class AccessService implements Record<AccessOp, (args: never) => Promise<unknown>> {
  private readonly dbs = new Map<string, MDBReader>();

  private async database(db: string, file: Blob): Promise<MDBReader> {
    let reader = this.dbs.get(db);
    if (reader) this.dbs.delete(db);
    else reader = openDatabase(new Uint8Array(await file.arrayBuffer()));
    this.dbs.set(db, reader);
    while (this.dbs.size > KEEP) this.dbs.delete(this.dbs.keys().next().value!);
    return reader;
  }

  async read({ db, file, table }: AccessOps['read']['args']): Promise<AccessReadResult> {
    const reader = await this.database(db, file);
    const data = readTable(reader, table);
    return {
      tables: listTables(reader),
      table: data.table,
      rows: data.rows,
      columns: data.columns.map((c) => ({ name: c.name, sqlType: c.sqlType })),
      ipc: sheetToIPC(data.columns),
    };
  }

  async forget({ db }: AccessOps['forget']['args']): Promise<void> {
    this.dbs.delete(db);
  }

  /** Run an operation by name; failures come back as AccessError with a message fit to show. */
  async run<K extends AccessOp>(op: K, args: AccessOps[K]['args']): Promise<AccessOps[K]['result']> {
    try {
      return (await (this[op] as (a: AccessOps[K]['args']) => Promise<AccessOps[K]['result']>).call(this, args)) as AccessOps[K]['result'];
    } catch (e) {
      if (e instanceof AccessError) throw e;
      throw new AccessError(`This database can’t be read (${e instanceof Error ? e.message : String(e)}).`);
    }
  }
}
