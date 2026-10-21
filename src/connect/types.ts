// The connector interface: one per driver, used by the browser for connections that run in it, by puddle-connect
// for the rest, and by the runner. Rows come back as an Arrow IPC stream (or, for a database the engine itself has
// attached, as a relation to select from), and the compiler loads them into a staging table with their types.
import type { Catalog, Connection, ConnectionVia, DriverId } from '../model';

export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectorError';
  }
}

/** What a driver needs to reach its database for one call. */
export interface ConnectorContext {
  connection: Connection;
  secret?: string;
  /** A database file the user picked, for the file drivers. */
  file?: Blob;
  /** The engine, for a driver that reads through DuckDB itself (DuckDB files). */
  engine?: EngineLike;
  /** Set when the read is cancelled; a driver that can stop early checks it. */
  signal?: AbortSignal;
}

/** The little of the engine a driver may use. */
export interface EngineLike {
  query(sql: string): Promise<{ table: import('apache-arrow').Table }>;
  registerFile(name: string, file: File): Promise<void>;
  dropFile(name: string): Promise<void>;
}

export interface ReadRequest {
  table?: { schema?: string; name: string };
  query?: string;
  limit?: number;
  /** A condition on a table read, in the driver's own terms: a MongoDB filter document, a CQL WHERE condition. */
  filter?: string;
  /** Cassandra and ScyllaDB: let a filtered read scan the table (ALLOW FILTERING), which costs on a cluster. */
  allowFiltering?: boolean;
  /** How a document store's records become rows, over the connection's own depth. */
  shape?: { depth?: number; arrays?: 'json' | 'rows' };
}

/**
 * A read's rows: an Arrow IPC stream with its typed columns, or a relation in the engine to select from, with the
 * database to select it in when its tables are named as that database names them (a query over an attached file).
 * The columns and count of a relation are found once it is loaded, where a driver leaves them out.
 */
export type ReadResult = { ipc: Uint8Array; columns: { name: string; sqlType: string }[]; rows: number } | { relation: string; database?: string; columns?: { name: string; sqlType: string }[]; rows?: number };

/** A column as the database declares it, for documenting the schema. */
export interface DocColumn {
  name: string;
  type: string;
  pk: boolean;
  unique: boolean;
  notNull: boolean;
  increment: boolean;
  /** The default as written in the database, or undefined. */
  default?: string;
  note?: string;
}

export interface DocIndex {
  name?: string;
  columns: string[];
  unique: boolean;
}

/** A foreign key: these columns of the table reference `refColumns` of `refTable`. */
export interface DocForeignKey {
  name?: string;
  columns: string[];
  refSchema?: string;
  refTable: string;
  refColumns: string[];
}

export interface DocTable {
  schema?: string;
  name: string;
  kind: 'table' | 'view';
  note?: string;
  columns: DocColumn[];
  indexes: DocIndex[];
  foreignKeys: DocForeignKey[];
  /** A view's defining SQL. */
  sql?: string;
}

export interface DocEnum {
  schema?: string;
  name: string;
  values: string[];
}

/** Everything a driver can say about a database's schema (plan section 3.5), driver-neutral; src/schema/fromCatalog.ts turns it into DBML. */
export interface CatalogDetail {
  tables: DocTable[];
  enums: DocEnum[];
}

export type TestOutcome = { ok: true; server: string } | { ok: false; reason: string };

export interface Connector {
  id: DriverId;
  runsIn: ConnectionVia[];
  test(ctx: ConnectorContext): Promise<TestOutcome>;
  catalog(ctx: ConnectorContext): Promise<Catalog>;
  read(ctx: ConnectorContext, req: ReadRequest): Promise<ReadResult>;
  /** The schema in detail (keys, indexes, foreign keys, defaults, views, enums), for Document the schema; absent where the driver can't say. */
  document?(ctx: ConnectorContext): Promise<CatalogDetail>;
}
