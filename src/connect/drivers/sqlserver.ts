// SQL Server, read over TDS with tedious in puddle-connect and the runner. The connection asks for read-only intent
// and UTC, every value arrives plain (dates and fixed-point numbers as text) and is converted by
// src/connect/drivers/sqlserverTypes.ts, and the catalogue comes from INFORMATION_SCHEMA with sys.* for keys,
// indexes, foreign keys, view definitions, row counts and extended properties (MS_Description as notes), each part
// on its own so a lesser permission still documents the rest. The SQL here is Transact-SQL, not DuckDB's.
import { sheetToIPC } from '../../excel/arrow';
import type { SheetColumn } from '../../excel/types';
import type { Catalog, CatalogTable } from '../../model';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocColumn, type DocForeignKey, type DocIndex, type DocTable, type ReadRequest, type ReadResult, type TestOutcome } from '../types';
import { convertSqlserverValue, sqlserverColumnType, sqlserverFieldType, utcText, type SqlserverColumnRow, type SqlserverField } from './sqlserverTypes';
export type { SqlserverField } from './sqlserverTypes';

/** What the driver asks of a client: one statement at a time, rows as arrays of plain values, so tests can stand in for it. */
export interface SqlserverClientLike {
  query(sql: string): Promise<{ rows: unknown[][]; fields: SqlserverField[] }>;
  end(): Promise<void>;
}

export interface SqlserverConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  /** A Windows login's domain: the connection then signs in with NTLM. */
  domain?: string;
  /** The secret is an Entra ID access token rather than a password. */
  token?: boolean;
  encrypt: boolean;
  trustCertificate: boolean;
}

export type SqlserverConnect = (config: SqlserverConfig) => Promise<SqlserverClientLike>;

interface ValueMetadata {
  type: { name: string };
  scale?: number;
}

/** tedious's value for a column, made plain: dates as UTC wall-clock text, fixed-point numbers as text with their scale, big integers as text, bytes as bytes. */
export function plainValue(metadata: ValueMetadata, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  const name = metadata.type.name;
  if (v instanceof Date) {
    if (name === 'Date') return utcText(v, 'date');
    if (name === 'Time') return utcText(v, 'time');
    if (name === 'DateTimeOffset') return v.toISOString();
    return utcText(v, 'timestamp');
  }
  if (typeof v === 'number' && /^(Decimal|Numeric|Money|SmallMoney)N?$/.test(name)) return v.toFixed(name.startsWith('Money') || name.startsWith('SmallMoney') ? 4 : (metadata.scale ?? 0));
  if (Buffer.isBuffer(v)) return new Uint8Array(v);
  return v;
}

/** Connects with tedious. */
export const sqlserverConnect: SqlserverConnect = async (config) => {
  const { Connection, Request } = await import('tedious');
  const authentication = config.domain
    ? { type: 'ntlm' as const, options: { userName: config.user, password: config.password ?? '', domain: config.domain } }
    : config.token
      ? { type: 'azure-active-directory-access-token' as const, options: { token: config.password ?? '' } }
      : { type: 'default' as const, options: { userName: config.user, password: config.password ?? '' } };
  const conn = new Connection({
    server: config.host,
    authentication,
    options: { port: config.port, database: config.database, encrypt: config.encrypt, trustServerCertificate: config.trustCertificate, readOnlyIntent: true, useUTC: true, useColumnNames: false, rowCollectionOnRequestCompletion: false, connectTimeout: 10_000, requestTimeout: 0 },
  });
  await new Promise<void>((resolve, reject) => conn.connect((err) => (err ? reject(err) : resolve())));
  return {
    query: (sql) =>
      new Promise((resolve, reject) => {
        let fields: SqlserverField[] = [];
        const rows: unknown[][] = [];
        const request = new Request(sql, (err) => (err ? reject(err) : resolve({ rows, fields })));
        request.on('columnMetadata', (columns) => {
          fields = (columns as { colName: string; type: { name: string }; dataLength?: number; precision?: number; scale?: number }[]).map((c) => ({ name: c.colName, type: c.type.name, ...(c.dataLength !== undefined ? { dataLength: c.dataLength } : {}), ...(c.precision !== undefined ? { precision: c.precision } : {}), ...(c.scale !== undefined ? { scale: c.scale } : {}) }));
        });
        request.on('row', (columns: { value: unknown; metadata: ValueMetadata }[]) => rows.push(columns.map((c) => plainValue(c.metadata, c.value))));
        conn.execSql(request);
      }),
    end: () =>
      new Promise((resolve) => {
        conn.once('end', () => resolve());
        conn.close();
      }),
  };
};

type Row = Record<string, unknown>;

const quote = (name: string) => `[${name.replaceAll(']', ']]')}]`;
const qualified = (t: { schema?: string; name: string }) => `${quote(t.schema || 'dbo')}.${quote(t.name)}`;

/** The settings as a client config. The secret is the password, or the access token with "Entra ID token" on. */
export function sqlserverConfigFor(ctx: ConnectorContext): SqlserverConfig {
  const s = ctx.connection.settings;
  const host = String(s.host ?? '').trim();
  const database = String(s.database ?? '').trim();
  const user = String(s.user ?? '').trim();
  const domain = String(s.domain ?? '').trim();
  const token = s.entra === true;
  if (!host) throw new ConnectorError('Give the database host.');
  if (!database) throw new ConnectorError('Give the database name.');
  if (!user && !token) throw new ConnectorError('Give the user name.');
  return { host, port: Number(s.port) || 1433, database, user, ...(ctx.secret !== undefined ? { password: ctx.secret } : {}), ...(domain ? { domain } : {}), ...(token ? { token } : {}), encrypt: s.encrypt !== false, trustCertificate: s.sslVerify === false };
}

/** A tedious failure in plain words, without echoing anything secret. */
export function sqlserverProblem(e: unknown, config: SqlserverConfig): ConnectorError {
  if (e instanceof ConnectorError) return e;
  const err = e as { code?: string; number?: number; message?: string };
  const message = err.message ?? String(e);
  if (err.code === 'ESOCKET' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEOUT' || /Failed to connect|ECONNREFUSED|ENOTFOUND|getaddrinfo|timeout/i.test(message)) return new ConnectorError(`Nothing answers at ${config.host}:${config.port}.`);
  if (err.number === 18456 || err.code === 'ELOGIN' || /Login failed/i.test(message)) return new ConnectorError('The database refused the user name or password.');
  if (err.number === 4060 || /Cannot open database/i.test(message)) return new ConnectorError(`There is no database called ${config.database} on ${config.host}, or this user may not open it.`);
  if (/self[- ]signed|certificate/i.test(message)) return new ConnectorError('The server’s certificate isn’t trusted. Turn off “Check the certificate” for a self-signed one.');
  return new ConnectorError(`The database answered: ${message}`);
}

/** The server's version in short: "SQL Server 16.0.4305 (Developer Edition)". */
export function shortVersion(version: string, edition?: string): string {
  const v = version.split('.').slice(0, 3).join('.');
  return `SQL Server ${v}${edition ? ` (${edition})` : ''}`;
}

/** Run a catalogue query, or nothing when the user may not read what it reads. */
async function maybe(client: SqlserverClientLike, sql: string): Promise<Row[]> {
  try {
    return await objects(client, sql);
  } catch {
    return [];
  }
}

const objects = async (client: SqlserverClientLike, sql: string): Promise<Row[]> => {
  const r = await client.query(sql);
  return r.rows.map((row) => Object.fromEntries(r.fields.map((f, i) => [f.name, row[i]])));
};

export const TABLES_SQL = "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW') ORDER BY TABLE_SCHEMA, TABLE_NAME";
export const COLUMNS_SQL = "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION, IS_NULLABLE, COLUMN_DEFAULT, COLUMNPROPERTY(OBJECT_ID(QUOTENAME(TABLE_SCHEMA) + '.' + QUOTENAME(TABLE_NAME)), COLUMN_NAME, 'IsIdentity') AS IS_IDENTITY FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION";
export const ROWS_SQL = 'SELECT s.name AS TABLE_SCHEMA, t.name AS TABLE_NAME, SUM(p.rows) AS ROW_COUNT FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1) GROUP BY s.name, t.name';
export const INDEXES_SQL = 'SELECT s.name AS TABLE_SCHEMA, o.name AS TABLE_NAME, i.name AS INDEX_NAME, i.is_primary_key AS IS_PRIMARY, i.is_unique AS IS_UNIQUE, i.is_unique_constraint AS IS_UNIQUE_CONSTRAINT, c.name AS COLUMN_NAME, ic.key_ordinal AS KEY_ORDINAL FROM sys.indexes i JOIN sys.objects o ON o.object_id = i.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id WHERE o.is_ms_shipped = 0 AND i.type > 0 AND i.is_hypothetical = 0 AND ic.is_included_column = 0 ORDER BY s.name, o.name, i.name, ic.key_ordinal';
export const FOREIGN_KEYS_SQL = 'SELECT s.name AS TABLE_SCHEMA, o.name AS TABLE_NAME, fk.name AS CONSTRAINT_NAME, c.name AS COLUMN_NAME, rs.name AS REF_SCHEMA, ro.name AS REF_TABLE, rc.name AS REF_COLUMN FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id JOIN sys.objects o ON o.object_id = fk.parent_object_id JOIN sys.schemas s ON s.schema_id = o.schema_id JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id JOIN sys.objects ro ON ro.object_id = fk.referenced_object_id JOIN sys.schemas rs ON rs.schema_id = ro.schema_id JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id ORDER BY s.name, o.name, fk.name, fkc.constraint_column_id';
export const VIEWS_SQL = 'SELECT s.name AS TABLE_SCHEMA, v.name AS TABLE_NAME, m.definition AS DEFINITION FROM sys.views v JOIN sys.schemas s ON s.schema_id = v.schema_id JOIN sys.sql_modules m ON m.object_id = v.object_id WHERE v.is_ms_shipped = 0';
export const NOTES_SQL = "SELECT s.name AS TABLE_SCHEMA, o.name AS TABLE_NAME, c.name AS COLUMN_NAME, CAST(ep.value AS nvarchar(max)) AS NOTE FROM sys.extended_properties ep JOIN sys.objects o ON o.object_id = ep.major_id JOIN sys.schemas s ON s.schema_id = o.schema_id LEFT JOIN sys.columns c ON c.object_id = ep.major_id AND c.column_id = ep.minor_id AND ep.minor_id > 0 WHERE ep.class = 1 AND ep.name = 'MS_Description' AND o.type IN ('U', 'V')";
const VERSION_SQL = "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version, CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition";
const COUNT_SQL = "SELECT count(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')";

export interface TableRow extends Row {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  TABLE_TYPE: string;
}

export interface ColumnRow extends SqlserverColumnRow, Row {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  IS_NULLABLE: string;
  COLUMN_DEFAULT: string | null;
  IS_IDENTITY: number | boolean | null;
}

const key = (schema: unknown, name: unknown) => `${String(schema)}.${String(name)}`;
/** dbo, the default schema, goes unnamed; every other schema is named. */
const schemaOf = (schema: string) => (schema === 'dbo' ? {} : { schema });
const isView = (t: TableRow) => t.TABLE_TYPE === 'VIEW';

/** A default as DBML wants it: SQL Server wraps defaults in brackets, `((1))` or `('placed')` or `(getdate())`. */
export function sqlserverDefault(d: string | null | undefined): string | undefined {
  if (d === null || d === undefined) return undefined;
  let v = d.trim();
  while (v.startsWith('(') && v.endsWith(')')) v = v.slice(1, -1).trim();
  return v || undefined;
}

/** The catalogue's tables from the rows INFORMATION_SCHEMA gave. */
export function catalogFromRows(tables: TableRow[], columns: ColumnRow[], rowCounts: Row[] = []): Catalog {
  const byTable = new Map<string, ColumnRow[]>();
  for (const c of columns) byTable.set(key(c.TABLE_SCHEMA, c.TABLE_NAME), [...(byTable.get(key(c.TABLE_SCHEMA, c.TABLE_NAME)) ?? []), c]);
  const counts = new Map(rowCounts.map((r) => [key(r.TABLE_SCHEMA, r.TABLE_NAME), Number(r.ROW_COUNT)]));
  return {
    tables: tables.map((t): CatalogTable => {
      const n = counts.get(key(t.TABLE_SCHEMA, t.TABLE_NAME));
      return {
        ...schemaOf(t.TABLE_SCHEMA),
        name: t.TABLE_NAME,
        kind: isView(t) ? 'view' : 'table',
        columns: (byTable.get(key(t.TABLE_SCHEMA, t.TABLE_NAME)) ?? []).map((c) => ({ name: c.COLUMN_NAME, type: sqlserverColumnType(c).sqlType, nullable: c.IS_NULLABLE === 'YES' })),
        ...(n && !isView(t) ? { rows: n } : {}),
      };
    }),
  };
}

export interface DetailRows {
  tables: TableRow[];
  columns: ColumnRow[];
  indexes?: Row[];
  foreignKeys?: Row[];
  views?: Row[];
  notes?: Row[];
}

/** The schema in detail from the catalogue rows: pure, so it is checked without a server. */
export function detailFromRows(r: DetailRows): CatalogDetail {
  const columnsOf = new Map<string, ColumnRow[]>();
  for (const c of r.columns) columnsOf.set(key(c.TABLE_SCHEMA, c.TABLE_NAME), [...(columnsOf.get(key(c.TABLE_SCHEMA, c.TABLE_NAME)) ?? []), c]);
  const indexesOf = new Map<string, Map<string, { primary: boolean; unique: boolean; columns: string[] }>>();
  for (const i of r.indexes ?? []) {
    const k = key(i.TABLE_SCHEMA, i.TABLE_NAME);
    const table = indexesOf.get(k) ?? new Map();
    indexesOf.set(k, table);
    const name = String(i.INDEX_NAME);
    const index = table.get(name) ?? { primary: Boolean(Number(i.IS_PRIMARY)), unique: Boolean(Number(i.IS_UNIQUE)) || Boolean(Number(i.IS_UNIQUE_CONSTRAINT)), columns: [] };
    index.columns.push(String(i.COLUMN_NAME));
    table.set(name, index);
  }
  const fksOf = new Map<string, Map<string, DocForeignKey>>();
  for (const k of r.foreignKeys ?? []) {
    const tk = key(k.TABLE_SCHEMA, k.TABLE_NAME);
    const table = fksOf.get(tk) ?? new Map<string, DocForeignKey>();
    fksOf.set(tk, table);
    const name = String(k.CONSTRAINT_NAME);
    const fk = table.get(name) ?? { name, columns: [], ...schemaOf(String(k.REF_SCHEMA)).schema ? { refSchema: String(k.REF_SCHEMA) } : {}, refTable: String(k.REF_TABLE), refColumns: [] };
    fk.columns.push(String(k.COLUMN_NAME));
    fk.refColumns.push(String(k.REF_COLUMN));
    table.set(name, fk);
  }
  const views = new Map((r.views ?? []).map((v) => [key(v.TABLE_SCHEMA, v.TABLE_NAME), String(v.DEFINITION ?? '')]));
  const tableNotes = new Map<string, string>();
  const columnNotes = new Map<string, string>();
  for (const n of r.notes ?? []) {
    if (!n.NOTE) continue;
    if (n.COLUMN_NAME) columnNotes.set(`${key(n.TABLE_SCHEMA, n.TABLE_NAME)}.${String(n.COLUMN_NAME)}`, String(n.NOTE));
    else tableNotes.set(key(n.TABLE_SCHEMA, n.TABLE_NAME), String(n.NOTE));
  }
  return {
    tables: r.tables.map((t): DocTable => {
      const k = key(t.TABLE_SCHEMA, t.TABLE_NAME);
      const indexes = indexesOf.get(k) ?? new Map<string, { primary: boolean; unique: boolean; columns: string[] }>();
      const pk = [...indexes.values()].find((i) => i.primary)?.columns ?? [];
      const single = new Set([...indexes.values()].filter((i) => !i.primary && i.unique && i.columns.length === 1).map((i) => i.columns[0]!));
      const columns = (columnsOf.get(k) ?? []).map((c): DocColumn => {
        const d = sqlserverDefault(c.COLUMN_DEFAULT);
        const note = columnNotes.get(`${k}.${c.COLUMN_NAME}`);
        return {
          name: c.COLUMN_NAME,
          type: sqlserverColumnType(c).declared,
          pk: pk.length === 1 && pk[0] === c.COLUMN_NAME,
          unique: single.has(c.COLUMN_NAME),
          notNull: c.IS_NULLABLE === 'NO',
          increment: Boolean(Number(c.IS_IDENTITY)),
          ...(d !== undefined ? { default: d } : {}),
          ...(note ? { note } : {}),
        };
      });
      const others = [...indexes.entries()].filter(([, i]) => !i.primary && !(i.unique && i.columns.length === 1)).map(([name, i]): DocIndex => ({ name, columns: i.columns, unique: i.unique }));
      const sql = views.get(k);
      const note = tableNotes.get(k);
      return {
        ...schemaOf(t.TABLE_SCHEMA),
        name: t.TABLE_NAME,
        kind: isView(t) ? 'view' : 'table',
        ...(note ? { note } : {}),
        columns,
        indexes: [...(pk.length > 1 ? [{ columns: pk, unique: true } satisfies DocIndex] : []), ...others],
        foreignKeys: [...(fksOf.get(k)?.values() ?? [])],
        ...(sql ? { sql: sql.trim() } : {}),
      };
    }),
    enums: [],
  };
}

/** A read's rows as sheet columns typed from the result's fields. */
export function sheetFromResult(fields: SqlserverField[], rows: unknown[][]): { columns: SheetColumn[]; sqlTypes: string[] } {
  const types = fields.map(sqlserverFieldType);
  return {
    columns: fields.map((f, i) => ({ name: f.name, type: types[i]!.type, values: rows.map((row) => convertSqlserverValue(row[i], types[i]!.type)) })),
    sqlTypes: types.map((t) => t.sqlType),
  };
}

/**
 * The SQL a read runs, as one batch. A table is read with TOP; a query is run as written, after SET ROWCOUNT bounds
 * it, since a query that ends in ORDER BY can't sit inside a derived table in Transact-SQL (the SET must share the
 * batch: tedious runs each request through sp_executesql, whose SET options end with it). The batch runs in a
 * transaction that is rolled back, so a statement that writes leaves nothing behind: read-only intent only steers
 * an availability group to a readable replica, it doesn't refuse a write.
 */
export function readSql(req: ReadRequest): string {
  const limit = req.limit ? Math.max(1, Math.floor(req.limit)) : undefined;
  if (req.table) return `SELECT ${limit ? `TOP (${limit}) ` : ''}* FROM ${qualified(req.table)}`;
  const query = (req.query ?? '').trim().replace(/;\s*$/, '');
  return `${limit ? `SET ROWCOUNT ${limit};\n` : ''}BEGIN TRANSACTION;\n${query};\nROLLBACK TRANSACTION`;
}

export function sqlserverConnector(connect: SqlserverConnect = sqlserverConnect): Connector {
  const withClient = async <T>(ctx: ConnectorContext, fn: (client: SqlserverClientLike) => Promise<T>): Promise<T> => {
    const config = sqlserverConfigFor(ctx);
    let client: SqlserverClientLike;
    try {
      client = await connect(config);
    } catch (e) {
      throw sqlserverProblem(e, config);
    }
    const stop = () => void client.end().catch(() => undefined);
    ctx.signal?.addEventListener('abort', stop);
    try {
      return await fn(client);
    } catch (e) {
      if (ctx.signal?.aborted) throw new ConnectorError('The read was cancelled.');
      throw sqlserverProblem(e, config);
    } finally {
      ctx.signal?.removeEventListener('abort', stop);
      await client.end().catch(() => undefined);
    }
  };
  return {
    id: 'sqlserver',
    runsIn: ['local', 'pi'],
    test: (ctx): Promise<TestOutcome> =>
      withClient(ctx, async (client) => {
        const v = (await objects(client, VERSION_SQL))[0] ?? {};
        const n = Number((await objects(client, COUNT_SQL))[0]?.n ?? 0);
        return { ok: true, server: `${shortVersion(String(v.version ?? ''), v.edition ? String(v.edition) : undefined)}, ${n} ${n === 1 ? 'table' : 'tables'}` };
      }),
    catalog: (ctx) => withClient(ctx, async (client) => catalogFromRows((await objects(client, TABLES_SQL)) as TableRow[], (await objects(client, COLUMNS_SQL)) as ColumnRow[], await maybe(client, ROWS_SQL))),
    document: (ctx) =>
      withClient(ctx, async (client) =>
        detailFromRows({
          tables: (await objects(client, TABLES_SQL)) as TableRow[],
          columns: (await objects(client, COLUMNS_SQL)) as ColumnRow[],
          indexes: await maybe(client, INDEXES_SQL),
          foreignKeys: await maybe(client, FOREIGN_KEYS_SQL),
          views: await maybe(client, VIEWS_SQL),
          notes: await maybe(client, NOTES_SQL),
        }),
      ),
    read: (ctx, req): Promise<ReadResult> =>
      withClient(ctx, async (client) => {
        if (!req.table && !req.query) throw new ConnectorError('Choose a table or write a query.');
        const r = await client.query(readSql(req));
        // A statement that returned no columns wasn't a read (an UPDATE, say); its transaction was rolled back.
        if (!r.fields.length) throw new ConnectorError('That statement returned no rows to read; the connection only reads.');
        const { columns, sqlTypes } = sheetFromResult(r.fields, r.rows);
        return { ipc: sheetToIPC(columns), columns: columns.map((c, i) => ({ name: c.name, sqlType: sqlTypes[i]! })), rows: r.rows.length };
      }),
  };
}
