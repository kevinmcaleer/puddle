// The MySQL family (MySQL, MariaDB, TiDB), read over the MySQL wire with the mysql2 client in puddle-connect and the
// runner. The session is read-only where the database allows it and runs in UTC, every value arrives as bytes and
// is decoded and converted by src/connect/drivers/mysqlTypes.ts, and the catalogue comes from information_schema
// (TABLES, COLUMNS, STATISTICS, KEY_COLUMN_USAGE, VIEWS) for the connection's database, each part on its own so a
// database without one still documents the rest. The SQL here is MySQL's own dialect, not DuckDB's.
import { sheetToIPC } from '../../excel/arrow';
import type { SheetColumn } from '../../excel/types';
import type { Catalog, CatalogTable } from '../../model';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocColumn, type DocEnum, type DocForeignKey, type DocIndex, type DocTable, type ReadRequest, type ReadResult, type TestOutcome } from '../types';
import { convertMysqlValue, enumValues, mysqlColumnType, mysqlFieldType, type MysqlField } from './mysqlTypes';
export type { MysqlField } from './mysqlTypes';

export type MysqlDriverId = 'mysql' | 'mariadb' | 'tidb';

/** What the driver asks of a client: the little of mysql2's Connection it uses, with every value as bytes (typeCast off), so tests can stand in for it. */
export interface MysqlClientLike {
  query(sql: string, rowsAsArray?: boolean): Promise<{ rows: unknown[]; fields: MysqlField[] }>;
  end(): Promise<void>;
}

export interface MysqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl?: { rejectUnauthorized: boolean };
}

export type MysqlConnect = (config: MysqlConfig) => Promise<MysqlClientLike>;

/** Connects with mysql2; every value is left as the bytes the database sent. */
export const mysqlConnect: MysqlConnect = async (config) => {
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({ ...config, connectTimeout: 10_000, typeCast: false, multipleStatements: false, dateStrings: true });
  return {
    query: async (sql, rowsAsArray) => {
      const [rows, fields] = (await conn.query({ sql, rowsAsArray: rowsAsArray ?? false })) as [unknown[], MysqlField[]];
      return { rows, fields };
    },
    end: () => conn.end(),
  };
};

/** A row as the catalogue queries return it, decoded from bytes to text. */
type Row = Record<string, string | null>;

const quote = (name: string) => `\`${name.replaceAll('`', '``')}\``;
const qualified = (t: { schema?: string; name: string }) => (t.schema ? `${quote(t.schema)}.${quote(t.name)}` : quote(t.name));

const asText = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Uint8Array ? Buffer.from(v).toString('utf8') : String(v));
const textRows = (rows: unknown[]): Row[] => rows.map((r) => Object.fromEntries(Object.entries(r as Record<string, unknown>).map(([k, v]) => [k, asText(v)])));

/** The settings as a client config. The secret is the password. */
export function mysqlConfigFor(ctx: ConnectorContext): MysqlConfig {
  const s = ctx.connection.settings;
  const host = String(s.host ?? '').trim();
  const database = String(s.database ?? '').trim();
  const user = String(s.user ?? '').trim();
  if (!host) throw new ConnectorError('Give the database host.');
  if (!database) throw new ConnectorError('Give the database name.');
  if (!user) throw new ConnectorError('Give the user name.');
  const port = Number(s.port) || 3306;
  return { host, port, database, user, ...(ctx.secret !== undefined ? { password: ctx.secret } : {}), ...(s.ssl ? { ssl: { rejectUnauthorized: s.sslVerify !== false } } : {}) };
}

/** A mysql2 failure in plain words, without echoing anything secret. */
export function mysqlProblem(e: unknown, config: MysqlConfig): ConnectorError {
  if (e instanceof ConnectorError) return e;
  const err = e as { code?: string; message?: string };
  const message = err.message ?? String(e);
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' || err.code === 'ETIMEDOUT' || /connect ETIMEDOUT|Handshake inactivity/i.test(message)) return new ConnectorError(`Nothing answers at ${config.host}:${config.port}.`);
  if (err.code === 'ER_ACCESS_DENIED_ERROR' || err.code === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR') return new ConnectorError('The database refused the user name or password.');
  if (err.code === 'ER_BAD_DB_ERROR' || err.code === 'ER_DBACCESS_DENIED_ERROR') return new ConnectorError(`There is no database called ${config.database} on ${config.host}, or this user may not open it.`);
  if (/self[- ]signed|certificate/i.test(message)) return new ConnectorError('The server’s certificate isn’t trusted. Turn off “Check the certificate” for a self-signed one.');
  if (/does not support (secure|SSL)/i.test(message)) return new ConnectorError('The server doesn’t use SSL. Turn off “Use SSL”.');
  return new ConnectorError(`The database answered: ${message}`);
}

/** The server's version in short: "MariaDB 10.11.14", "MySQL 8.0.36", "TiDB v7.5.0". */
export function shortVersion(version: string): string {
  const tidb = /TiDB-(v?[\w.]+)/i.exec(version);
  if (tidb) return `TiDB ${tidb[1]}`;
  const maria = /^([\d.]+)-MariaDB/i.exec(version);
  if (maria) return `MariaDB ${maria[1]}`;
  return `MySQL ${version.split('-')[0]}`;
}

/** Run a catalogue query, or nothing when the database hasn't got what it reads. */
async function maybe(client: MysqlClientLike, sql: string): Promise<Row[]> {
  try {
    return textRows((await client.query(sql)).rows);
  } catch {
    return [];
  }
}

const TABLES_SQL = 'SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME';
const COLUMNS_SQL = 'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION';
const INDEXES_SQL = 'SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX';
const FOREIGN_KEYS_SQL = 'SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, ORDINAL_POSITION FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION';
const VIEWS_SQL = 'SELECT TABLE_NAME, VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()';

interface TableRow extends Row {
  TABLE_NAME: string;
  TABLE_TYPE: string;
}

interface ColumnRow extends Row {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  COLUMN_TYPE: string;
  IS_NULLABLE: string;
  COLUMN_DEFAULT: string | null;
  EXTRA: string | null;
}

const isView = (t: TableRow) => t.TABLE_TYPE === 'VIEW' || t.TABLE_TYPE === 'SYSTEM VIEW';
const TEXTUAL = /^(char|varchar|tinytext|text|mediumtext|longtext|enum|set|date|datetime|timestamp|time|year|json)$/i;

/**
 * A default as DBML wants it: MariaDB quotes string defaults and writes NULL as the text NULL; MySQL and TiDB
 * write the bare value, so a string gets its quotes back unless it is an expression (CURRENT_TIMESTAMP, a call).
 */
export function mysqlDefault(c: Pick<ColumnRow, 'DATA_TYPE' | 'COLUMN_DEFAULT' | 'EXTRA'>): string | undefined {
  const d = c.COLUMN_DEFAULT;
  if (d === null || d === undefined || d === 'NULL') return undefined;
  if (/DEFAULT_GENERATED/i.test(c.EXTRA ?? '') || /^current_timestamp/i.test(d) || /^[\w.]+\(.*\)$/.test(d) || d.startsWith("'")) return d;
  return TEXTUAL.test(c.DATA_TYPE) ? `'${d.replaceAll("'", "''")}'` : d;
}

/** The catalogue's tables from the rows information_schema gave. */
export function catalogFromRows(tables: TableRow[], columns: ColumnRow[]): Catalog {
  const byTable = new Map<string, ColumnRow[]>();
  for (const c of columns) byTable.set(c.TABLE_NAME, [...(byTable.get(c.TABLE_NAME) ?? []), c]);
  return {
    tables: tables.map((t): CatalogTable => {
      const n = Number(t.TABLE_ROWS);
      return {
        name: t.TABLE_NAME,
        kind: isView(t) ? 'view' : 'table',
        columns: (byTable.get(t.TABLE_NAME) ?? []).map((c) => ({ name: c.COLUMN_NAME, type: mysqlColumnType(c).sqlType, nullable: c.IS_NULLABLE === 'YES' })),
        ...(t.TABLE_ROWS !== null && !isView(t) && n > 0 ? { rows: n } : {}),
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
}

/** The schema in detail from the catalogue rows: pure, so each family's rows can be checked without its server. An ENUM column becomes an enum named table_column. */
export function detailFromRows(r: DetailRows): CatalogDetail {
  const columnsOf = new Map<string, ColumnRow[]>();
  for (const c of r.columns) columnsOf.set(c.TABLE_NAME, [...(columnsOf.get(c.TABLE_NAME) ?? []), c]);
  // Indexes by table and name, in column order; PRIMARY is the key, a unique one-column index marks its column.
  const indexesOf = new Map<string, Map<string, { unique: boolean; columns: string[] }>>();
  for (const i of r.indexes ?? []) {
    const table = indexesOf.get(i.TABLE_NAME!) ?? new Map();
    indexesOf.set(i.TABLE_NAME!, table);
    const index = table.get(i.INDEX_NAME!) ?? { unique: i.NON_UNIQUE === '0', columns: [] };
    index.columns.push(i.COLUMN_NAME!);
    table.set(i.INDEX_NAME!, index);
  }
  const fksOf = new Map<string, Map<string, DocForeignKey>>();
  for (const k of r.foreignKeys ?? []) {
    const table = fksOf.get(k.TABLE_NAME!) ?? new Map<string, DocForeignKey>();
    fksOf.set(k.TABLE_NAME!, table);
    const fk = table.get(k.CONSTRAINT_NAME!) ?? { name: k.CONSTRAINT_NAME!, columns: [], refTable: k.REFERENCED_TABLE_NAME!, refColumns: [] };
    fk.columns.push(k.COLUMN_NAME!);
    fk.refColumns.push(k.REFERENCED_COLUMN_NAME!);
    table.set(k.CONSTRAINT_NAME!, fk);
  }
  const views = new Map((r.views ?? []).map((v) => [v.TABLE_NAME!, v.VIEW_DEFINITION ?? '']));
  const enums: DocEnum[] = [];
  return {
    tables: r.tables.map((t): DocTable => {
      const indexes = indexesOf.get(t.TABLE_NAME) ?? new Map();
      const pk: string[] = indexes.get('PRIMARY')?.columns ?? [];
      const single = new Set([...indexes.entries()].filter(([name, i]) => name !== 'PRIMARY' && i.unique && i.columns.length === 1).map(([, i]) => i.columns[0]!));
      const columns = (columnsOf.get(t.TABLE_NAME) ?? []).map((c): DocColumn => {
        const values = enumValues(c.COLUMN_TYPE);
        let type = c.COLUMN_TYPE.replace(/\s+unsigned$/i, ' unsigned');
        if (values && /^enum/i.test(c.COLUMN_TYPE)) {
          type = `${t.TABLE_NAME}_${c.COLUMN_NAME}`;
          enums.push({ name: type, values });
        }
        const d = mysqlDefault(c);
        return {
          name: c.COLUMN_NAME,
          type,
          pk: pk.length === 1 && pk[0] === c.COLUMN_NAME,
          unique: single.has(c.COLUMN_NAME),
          notNull: c.IS_NULLABLE === 'NO',
          increment: /auto_increment/i.test(c.EXTRA ?? ''),
          ...(d !== undefined ? { default: d } : {}),
          ...(c.COLUMN_COMMENT ? { note: c.COLUMN_COMMENT } : {}),
        };
      });
      const others = [...indexes.entries()].filter(([name, i]) => name !== 'PRIMARY' && !(i.unique && i.columns.length === 1)).map(([name, i]): DocIndex => ({ name, columns: i.columns, unique: i.unique }));
      const sql = views.get(t.TABLE_NAME);
      const note = isView(t) ? undefined : t.TABLE_COMMENT || undefined;
      return {
        name: t.TABLE_NAME,
        kind: isView(t) ? 'view' : 'table',
        ...(note ? { note } : {}),
        columns,
        indexes: [...(pk.length > 1 ? [{ columns: pk, unique: true } satisfies DocIndex] : []), ...others],
        foreignKeys: [...(fksOf.get(t.TABLE_NAME)?.values() ?? [])],
        ...(sql ? { sql: sql.trim() } : {}),
      };
    }),
    enums,
  };
}

/** A read's rows (every value bytes, or null) as sheet columns typed from the result's fields. */
export function sheetFromResult(fields: MysqlField[], rows: (Uint8Array | null)[][]): { columns: SheetColumn[]; sqlTypes: string[] } {
  const types = fields.map(mysqlFieldType);
  return {
    columns: fields.map((f, i) => ({
      name: f.name,
      type: types[i]!.type,
      values: rows.map((row) => {
        const v = row[i];
        const value = v === null || v === undefined ? null : types[i]!.type === 'BLOB' || (types[i]!.type !== 'VARCHAR' && f.columnType === 16) ? new Uint8Array(v) : Buffer.from(v).toString('utf8');
        return convertMysqlValue(value, types[i]!.type);
      }),
    })),
    sqlTypes: types.map((t) => t.sqlType),
  };
}

/** The SQL a read runs: a table whole, or the query as a subquery, with the limit on the outside. */
export function readSql(req: ReadRequest): string {
  const inner = req.table ? `SELECT * FROM ${qualified(req.table)}` : `SELECT * FROM (${(req.query ?? '').trim().replace(/;\s*$/, '')}) AS puddle_query`;
  return req.limit ? `${inner} LIMIT ${Math.max(1, Math.floor(req.limit))}` : inner;
}

const SESSION = ['SET SESSION TRANSACTION READ ONLY', "SET time_zone = '+00:00'"];

export function mysqlConnector(id: MysqlDriverId, connect: MysqlConnect = mysqlConnect): Connector {
  const withClient = async <T>(ctx: ConnectorContext, fn: (client: MysqlClientLike) => Promise<T>): Promise<T> => {
    const config = mysqlConfigFor(ctx);
    let client: MysqlClientLike;
    try {
      client = await connect(config);
    } catch (e) {
      throw mysqlProblem(e, config);
    }
    const stop = () => void client.end().catch(() => undefined);
    ctx.signal?.addEventListener('abort', stop);
    try {
      for (const sql of SESSION) await client.query(sql).catch(() => undefined);
      return await fn(client);
    } catch (e) {
      if (ctx.signal?.aborted) throw new ConnectorError('The read was cancelled.');
      throw mysqlProblem(e, config);
    } finally {
      ctx.signal?.removeEventListener('abort', stop);
      await client.end().catch(() => undefined);
    }
  };
  const typed = async (client: MysqlClientLike, sql: string) => textRows((await client.query(sql)).rows);
  return {
    id,
    runsIn: ['local', 'pi'],
    test: (ctx): Promise<TestOutcome> =>
      withClient(ctx, async (client) => {
        const version = (await typed(client, 'SELECT VERSION() AS version'))[0]?.version ?? '';
        const n = Number((await typed(client, 'SELECT count(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'))[0]?.n ?? 0);
        return { ok: true, server: `${shortVersion(version)}, ${n} ${n === 1 ? 'table' : 'tables'}` };
      }),
    catalog: (ctx) => withClient(ctx, async (client) => catalogFromRows((await typed(client, TABLES_SQL)) as TableRow[], (await typed(client, COLUMNS_SQL)) as ColumnRow[])),
    document: (ctx) =>
      withClient(ctx, async (client) =>
        detailFromRows({
          tables: (await typed(client, TABLES_SQL)) as TableRow[],
          columns: (await typed(client, COLUMNS_SQL)) as ColumnRow[],
          indexes: await maybe(client, INDEXES_SQL),
          foreignKeys: await maybe(client, FOREIGN_KEYS_SQL),
          views: await maybe(client, VIEWS_SQL),
        }),
      ),
    read: (ctx, req): Promise<ReadResult> =>
      withClient(ctx, async (client) => {
        if (!req.table && !req.query) throw new ConnectorError('Choose a table or write a query.');
        const r = await client.query(readSql(req), true);
        const { columns, sqlTypes } = sheetFromResult(r.fields, r.rows as (Uint8Array | null)[][]);
        return { ipc: sheetToIPC(columns), columns: columns.map((c, i) => ({ name: c.name, sqlType: sqlTypes[i]! })), rows: r.rows.length };
      }),
  };
}
