// Firebird, read over its wire protocol with node-firebird in puddle-connect and the runner. Every read runs in a
// read-only transaction, dates and fixed-point numbers arrive as text and are converted by
// src/connect/drivers/firebirdTypes.ts, and the catalogue comes from the RDB$ system tables (RDB$RELATIONS,
// RDB$RELATION_FIELDS joined to RDB$FIELDS, RDB$RELATION_CONSTRAINTS, RDB$INDICES with RDB$INDEX_SEGMENTS), each
// part on its own so an older server still documents the rest. Unquoted Firebird names are upper case, and that is
// how they are listed. The SQL here is Firebird's own dialect, not DuckDB's.
import { sheetToIPC } from '../../excel/arrow';
import type { SheetColumn } from '../../excel/types';
import type { Catalog, CatalogTable } from '../../model';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocColumn, type DocForeignKey, type DocIndex, type DocTable, type ReadRequest, type ReadResult, type TestOutcome } from '../types';
import { convertFirebirdValue, dateText, firebirdColumnType, firebirdFieldType, SQL_CODES, type FirebirdColumnRow, type FirebirdField } from './firebirdTypes';
export type { FirebirdField } from './firebirdTypes';

/** What the driver asks of a client: one query at a time in a read-only transaction, rows keyed by column alias, with every value already plain (text, number, boolean, bytes or null), so tests can stand in for it. */
export interface FirebirdClientLike {
  query(sql: string): Promise<{ rows: Record<string, unknown>[]; fields: FirebirdField[] }>;
  end(): Promise<void>;
}

export interface FirebirdConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  role?: string;
}

export type FirebirdConnect = (config: FirebirdConfig) => Promise<FirebirdClientLike>;

interface TypeCastColumn {
  type: number;
  scale?: number;
}

/** node-firebird's value for a column, made plain: dates as the database's wall-clock text, fixed-point numbers as text with their scale. */
export function plainValue(column: TypeCastColumn, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (column.type === SQL_CODES.DATE) return dateText(v, 'date');
    if (column.type === SQL_CODES.TIME || column.type === SQL_CODES.TIME_TZ || column.type === SQL_CODES.TIME_TZ_EX) return dateText(v, 'time');
    if (column.type === SQL_CODES.TIMESTAMP) return dateText(v, 'timestamp');
    return v.toISOString();
  }
  if (typeof v === 'number' && column.scale !== undefined && column.scale < 0) return v.toFixed(-column.scale);
  return v;
}

type BlobReader = (cb: (err: Error | null, name: string, stream: NodeJS.EventEmitter) => void) => void;

/** A binary BLOB comes as a function that streams it; read it whole. */
const readBlob = (fetch: BlobReader): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    fetch((err, _name, stream) => {
      if (err) return reject(err);
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
      stream.on('error', reject);
    });
  });

/** Connects with node-firebird and opens a read-only transaction that every query runs in. */
export const firebirdConnect: FirebirdConnect = async (config) => {
  const Firebird = (await import('node-firebird')).default;
  const db = await Firebird.attachAsync({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password ?? '',
    ...(config.role ? { role: config.role } : {}),
    encoding: 'UTF8',
    blobAsText: true,
    numericMode: 'string',
    typeCast: (column, next) => plainValue(column, next()),
  });
  const tr = await db.transactionAsync({ isolation: Firebird.ISOLATION_READ_COMMITTED, readOnly: true });
  return {
    query: async (sql) => {
      const r = await tr.queryAsync<Record<string, unknown>>(sql, [], { withMeta: true });
      const rows = Array.isArray(r.rows) ? r.rows : r.rows ? [r.rows] : [];
      for (const row of rows) for (const [k, v] of Object.entries(row)) if (typeof v === 'function') row[k] = await readBlob(v as BlobReader);
      return { rows, fields: r.fields.map((f) => ({ alias: f.alias ?? f.field ?? '', type: f.type, subType: f.subType ?? null, scale: f.scale ?? 0, length: f.length ?? 0, ...(f.field ? { field: f.field } : {}), ...(f.relation ? { relation: f.relation } : {}) })) };
    },
    end: async () => {
      await new Promise<void>((resolve) => tr.rollback(() => resolve()));
      await db.detachAsync().catch(() => undefined);
    },
  };
};

type Row = Record<string, unknown>;

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** The settings as a client config. The secret is the password. */
export function firebirdConfigFor(ctx: ConnectorContext): FirebirdConfig {
  const s = ctx.connection.settings;
  const host = String(s.host ?? '').trim();
  const database = String(s.database ?? '').trim();
  const user = String(s.user ?? '').trim();
  if (!host) throw new ConnectorError('Give the database host.');
  if (!database) throw new ConnectorError('Give the path of the database file on the server.');
  if (!user) throw new ConnectorError('Give the user name.');
  const role = String(s.role ?? '').trim();
  return { host, port: Number(s.port) || 3050, database, user, ...(ctx.secret !== undefined ? { password: ctx.secret } : {}), ...(role ? { role } : {}) };
}

/** A node-firebird failure in plain words, without echoing anything secret. */
export function firebirdProblem(e: unknown, config: FirebirdConfig): ConnectorError {
  if (e instanceof ConnectorError) return e;
  const err = e as { code?: string; gdscode?: number; message?: string };
  const message = err.message ?? String(e);
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' || err.code === 'ETIMEDOUT' || /ECONNREFUSED|ENOTFOUND|timed? ?out/i.test(message)) return new ConnectorError(`Nothing answers at ${config.host}:${config.port}.`);
  if (err.gdscode === 335544472 || /user name and password are not defined|Your user name and password/i.test(message)) return new ConnectorError('The database refused the user name or password.');
  if (err.gdscode === 335544344 || err.gdscode === 335544734 || /I\/O error|No such file|is not a valid database/i.test(message)) return new ConnectorError(`There is no database at ${config.database} on ${config.host}, or the server may not open it.`);
  if (err.gdscode === 335544361 || /read-? ?only transaction/i.test(message)) return new ConnectorError('The connection is read-only, so that statement can’t run.');
  return new ConnectorError(`The database answered: ${message}`);
}

/** Run a catalogue query, or nothing when the server hasn't got what it reads. */
async function maybe(client: FirebirdClientLike, sql: string): Promise<Row[]> {
  try {
    return (await client.query(sql)).rows;
  } catch {
    return [];
  }
}

const USER_TABLES = 'COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0';
export const TABLES_SQL = `SELECT TRIM(r.RDB$RELATION_NAME) AS TABLE_NAME, r.RDB$RELATION_TYPE AS RELATION_TYPE, r.RDB$VIEW_SOURCE AS VIEW_SOURCE, r.RDB$DESCRIPTION AS DESCRIPTION FROM RDB$RELATIONS r WHERE ${USER_TABLES} ORDER BY 1`;
export const COLUMNS_SQL = `SELECT TRIM(rf.RDB$RELATION_NAME) AS TABLE_NAME, TRIM(rf.RDB$FIELD_NAME) AS COLUMN_NAME, rf.RDB$FIELD_POSITION AS FIELD_POSITION, f.RDB$FIELD_TYPE AS FIELD_TYPE, f.RDB$FIELD_SUB_TYPE AS SUB_TYPE, f.RDB$FIELD_SCALE AS FIELD_SCALE, f.RDB$FIELD_LENGTH AS FIELD_LENGTH, f.RDB$CHARACTER_LENGTH AS CHARS, f.RDB$FIELD_PRECISION AS FIELD_PRECISION, COALESCE(rf.RDB$NULL_FLAG, f.RDB$NULL_FLAG) AS NULL_FLAG, COALESCE(rf.RDB$DEFAULT_SOURCE, f.RDB$DEFAULT_SOURCE) AS DEFAULT_SOURCE, rf.RDB$DESCRIPTION AS DESCRIPTION, rf.RDB$IDENTITY_TYPE AS IDENTITY_TYPE FROM RDB$RELATION_FIELDS rf JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = rf.RDB$RELATION_NAME WHERE ${USER_TABLES} ORDER BY 1, 3`;
export const CONSTRAINTS_SQL = `SELECT TRIM(rc.RDB$CONSTRAINT_NAME) AS CONSTRAINT_NAME, TRIM(rc.RDB$CONSTRAINT_TYPE) AS CONSTRAINT_TYPE, TRIM(rc.RDB$RELATION_NAME) AS TABLE_NAME, TRIM(rc.RDB$INDEX_NAME) AS INDEX_NAME, TRIM(ref.RDB$CONST_NAME_UQ) AS REF_NAME FROM RDB$RELATION_CONSTRAINTS rc LEFT JOIN RDB$REF_CONSTRAINTS ref ON ref.RDB$CONSTRAINT_NAME = rc.RDB$CONSTRAINT_NAME JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = rc.RDB$RELATION_NAME WHERE ${USER_TABLES} AND rc.RDB$CONSTRAINT_TYPE IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE') ORDER BY 3, 1`;
export const INDEXES_SQL = `SELECT TRIM(i.RDB$INDEX_NAME) AS INDEX_NAME, TRIM(i.RDB$RELATION_NAME) AS TABLE_NAME, COALESCE(i.RDB$UNIQUE_FLAG, 0) AS UNIQUE_FLAG, TRIM(s.RDB$FIELD_NAME) AS COLUMN_NAME, s.RDB$FIELD_POSITION AS FIELD_POSITION FROM RDB$INDICES i JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = i.RDB$INDEX_NAME JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = i.RDB$RELATION_NAME WHERE ${USER_TABLES} ORDER BY 1, 5`;
const VERSION_SQL = "SELECT rdb$get_context('SYSTEM', 'ENGINE_VERSION') AS VERSION FROM RDB$DATABASE";
const COUNT_SQL = `SELECT count(*) AS N FROM RDB$RELATIONS r WHERE ${USER_TABLES}`;

export interface TableRow extends Row {
  TABLE_NAME: string;
  RELATION_TYPE: number | null;
  VIEW_SOURCE: string | null;
  DESCRIPTION: string | null;
}

export interface ColumnRow extends FirebirdColumnRow, Row {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  NULL_FLAG: number | null;
  DEFAULT_SOURCE: string | null;
  DESCRIPTION: string | null;
  IDENTITY_TYPE: number | null;
}

const isView = (t: TableRow) => t.RELATION_TYPE === 1 || (t.RELATION_TYPE === null && t.VIEW_SOURCE !== null);

/** A default as DBML wants it: Firebird keeps the whole clause, `DEFAULT 'placed'`. */
export function firebirdDefault(source: string | null | undefined): string | undefined {
  if (!source) return undefined;
  const d = source.trim().replace(/^DEFAULT\s+/i, '').trim();
  return d || undefined;
}

/** The catalogue's tables from the RDB$ rows. */
export function catalogFromRows(tables: TableRow[], columns: ColumnRow[]): Catalog {
  const byTable = new Map<string, ColumnRow[]>();
  for (const c of columns) byTable.set(c.TABLE_NAME, [...(byTable.get(c.TABLE_NAME) ?? []), c]);
  return {
    tables: tables.map(
      (t): CatalogTable => ({
        name: t.TABLE_NAME,
        kind: isView(t) ? 'view' : 'table',
        columns: (byTable.get(t.TABLE_NAME) ?? []).map((c) => ({ name: c.COLUMN_NAME, type: firebirdColumnType(c).sqlType, nullable: c.NULL_FLAG !== 1 })),
      }),
    ),
  };
}

export interface DetailRows {
  tables: TableRow[];
  columns: ColumnRow[];
  constraints?: Row[];
  indexes?: Row[];
}

/** The schema in detail from the RDB$ rows: pure, so it is checked without a server. Keys are read through the indexes that back them. */
export function detailFromRows(r: DetailRows): CatalogDetail {
  const columnsOf = new Map<string, ColumnRow[]>();
  for (const c of r.columns) columnsOf.set(c.TABLE_NAME, [...(columnsOf.get(c.TABLE_NAME) ?? []), c]);
  // Every index with its columns in order; the constraints name the index that backs them.
  const indexes = new Map<string, { table: string; unique: boolean; columns: string[] }>();
  for (const i of r.indexes ?? []) {
    const index = indexes.get(String(i.INDEX_NAME)) ?? { table: String(i.TABLE_NAME), unique: Number(i.UNIQUE_FLAG) === 1, columns: [] };
    index.columns.push(String(i.COLUMN_NAME));
    indexes.set(String(i.INDEX_NAME), index);
  }
  const constraints = (r.constraints ?? []).map((c) => ({ name: String(c.CONSTRAINT_NAME), kind: String(c.CONSTRAINT_TYPE), table: String(c.TABLE_NAME), index: String(c.INDEX_NAME ?? ''), ref: c.REF_NAME ? String(c.REF_NAME) : undefined }));
  const byName = new Map(constraints.map((c) => [c.name, c]));
  const backing = new Set(constraints.map((c) => c.index));
  const columnsOfIndex = (name: string) => indexes.get(name)?.columns ?? [];
  return {
    tables: r.tables.map((t): DocTable => {
      const own = constraints.filter((c) => c.table === t.TABLE_NAME);
      const pk = columnsOfIndex(own.find((c) => c.kind === 'PRIMARY KEY')?.index ?? '');
      const uniques = own.filter((c) => c.kind === 'UNIQUE').map((c) => ({ name: c.name, columns: columnsOfIndex(c.index) }));
      const single = new Set(uniques.filter((u) => u.columns.length === 1).map((u) => u.columns[0]!));
      const columns = (columnsOf.get(t.TABLE_NAME) ?? []).map((c): DocColumn => {
        const d = firebirdDefault(c.DEFAULT_SOURCE);
        return {
          name: c.COLUMN_NAME,
          type: firebirdColumnType(c).declared,
          pk: pk.length === 1 && pk[0] === c.COLUMN_NAME,
          unique: single.has(c.COLUMN_NAME),
          notNull: c.NULL_FLAG === 1,
          increment: c.IDENTITY_TYPE !== null && c.IDENTITY_TYPE !== undefined,
          ...(d !== undefined ? { default: d } : {}),
          ...(c.DESCRIPTION ? { note: c.DESCRIPTION } : {}),
        };
      });
      const foreignKeys = own
        .filter((c) => c.kind === 'FOREIGN KEY')
        .map((c): DocForeignKey => {
          const target = c.ref ? byName.get(c.ref) : undefined;
          return { name: c.name, columns: columnsOfIndex(c.index), refTable: target?.table ?? '', refColumns: columnsOfIndex(target?.index ?? '') };
        })
        .filter((fk) => fk.refTable);
      const others = [...indexes.entries()].filter(([name, i]) => i.table === t.TABLE_NAME && !backing.has(name)).map(([name, i]): DocIndex => ({ name, columns: i.columns, unique: i.unique }));
      return {
        name: t.TABLE_NAME,
        kind: isView(t) ? 'view' : 'table',
        ...(t.DESCRIPTION ? { note: t.DESCRIPTION } : {}),
        columns,
        indexes: [...(pk.length > 1 ? [{ columns: pk, unique: true } satisfies DocIndex] : []), ...uniques.filter((u) => u.columns.length > 1).map((u): DocIndex => ({ name: u.name, columns: u.columns, unique: true })), ...others],
        foreignKeys,
        ...(isView(t) && t.VIEW_SOURCE ? { sql: t.VIEW_SOURCE.trim() } : {}),
      };
    }),
    enums: [],
  };
}

/** A read's rows as sheet columns typed from the result's fields. */
export function sheetFromResult(fields: FirebirdField[], rows: Row[]): { columns: SheetColumn[]; sqlTypes: string[] } {
  const types = fields.map(firebirdFieldType);
  return {
    columns: fields.map((f, i) => ({ name: f.alias, type: types[i]!.type, values: rows.map((row) => convertFirebirdValue(row[f.alias], types[i]!.type)) })),
    sqlTypes: types.map((t) => t.sqlType),
  };
}

/** The SQL a read runs: a table whole, or the query as a derived table, with the limit on the outside. */
export function readSql(req: ReadRequest): string {
  const inner = req.table ? `SELECT * FROM ${quote(req.table.name)}` : `SELECT * FROM (${(req.query ?? '').trim().replace(/;\s*$/, '')}) AS puddle_query`;
  return req.limit ? `${inner} FETCH FIRST ${Math.max(1, Math.floor(req.limit))} ROWS ONLY` : inner;
}

export function firebirdConnector(connect: FirebirdConnect = firebirdConnect): Connector {
  const withClient = async <T>(ctx: ConnectorContext, fn: (client: FirebirdClientLike) => Promise<T>): Promise<T> => {
    const config = firebirdConfigFor(ctx);
    let client: FirebirdClientLike;
    try {
      client = await connect(config);
    } catch (e) {
      throw firebirdProblem(e, config);
    }
    const stop = () => void client.end().catch(() => undefined);
    ctx.signal?.addEventListener('abort', stop);
    try {
      return await fn(client);
    } catch (e) {
      if (ctx.signal?.aborted) throw new ConnectorError('The read was cancelled.');
      throw firebirdProblem(e, config);
    } finally {
      ctx.signal?.removeEventListener('abort', stop);
      await client.end().catch(() => undefined);
    }
  };
  const rows = async (client: FirebirdClientLike, sql: string) => (await client.query(sql)).rows;
  return {
    id: 'firebird',
    runsIn: ['local', 'pi'],
    test: (ctx): Promise<TestOutcome> =>
      withClient(ctx, async (client) => {
        const version = String((await rows(client, VERSION_SQL))[0]?.VERSION ?? '');
        const n = Number((await rows(client, COUNT_SQL))[0]?.N ?? 0);
        return { ok: true, server: `Firebird ${version}, ${n} ${n === 1 ? 'table' : 'tables'}` };
      }),
    catalog: (ctx) => withClient(ctx, async (client) => catalogFromRows((await rows(client, TABLES_SQL)) as TableRow[], (await rows(client, COLUMNS_SQL)) as ColumnRow[])),
    document: (ctx) =>
      withClient(ctx, async (client) =>
        detailFromRows({
          tables: (await rows(client, TABLES_SQL)) as TableRow[],
          columns: (await rows(client, COLUMNS_SQL)) as ColumnRow[],
          constraints: await maybe(client, CONSTRAINTS_SQL),
          indexes: await maybe(client, INDEXES_SQL),
        }),
      ),
    read: (ctx, req): Promise<ReadResult> =>
      withClient(ctx, async (client) => {
        if (!req.table && !req.query) throw new ConnectorError('Choose a table or write a query.');
        const r = await client.query(readSql(req));
        const { columns, sqlTypes } = sheetFromResult(r.fields, r.rows);
        return { ipc: sheetToIPC(columns), columns: columns.map((c, i) => ({ name: c.name, sqlType: sqlTypes[i]! })), rows: r.rows.length };
      }),
  };
}
