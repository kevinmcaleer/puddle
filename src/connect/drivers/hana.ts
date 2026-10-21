// SAP HANA, read with node-hdb (SAP's pure-JavaScript client) in puddle-connect and the runner. The catalogue comes
// from the SYS views of the user's current schema: tables with their record counts and comments, views with their
// definitions, columns with their declared types, defaults, comments and identity generation, primary and unique
// keys from CONSTRAINTS, foreign keys from REFERENTIAL_CONSTRAINTS and the indexes. A read opens a read-only
// transaction and runs one reading statement. The SQL here is HANA's own, not DuckDB SQL.
import { sheetToIPC } from '../../excel/arrow';
import type { SheetColumn } from '../../excel/types';
import type { Catalog, CatalogTable } from '../../model';
import { statementProblem } from '../statement';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocColumn, type DocForeignKey, type DocIndex, type DocTable, type ReadRequest, type ReadResult, type TestOutcome } from '../types';
import type { ColumnMetadata } from 'hdb';
import { convertHanaValue, hanaColumnType, hanaFieldType, type HanaColumnRow, type HanaField } from './hanaTypes';

export type { HanaField } from './hanaTypes';

/** What the driver asks of a client: one statement at a time, rows as arrays with the columns described, so tests can stand in for it. */
export interface HanaClientLike {
  query(sql: string): Promise<{ rows: unknown[][]; fields: HanaField[] }>;
  end(): Promise<void>;
}

export interface HanaConfig {
  host: string;
  port: number;
  database?: string;
  user: string;
  password?: string;
  ssl: boolean;
  sslVerify: boolean;
}

export type HanaConnect = (config: HanaConfig) => Promise<HanaClientLike>;

/** Connects with node-hdb and opens a read-only transaction. */
export const hanaConnect: HanaConnect = async (config) => {
  const hdb = await import('hdb');
  const client = hdb.createClient({ host: config.host, port: config.port, user: config.user, password: config.password ?? '', ...(config.database ? { databaseName: config.database } : {}), useTLS: config.ssl, rejectUnauthorized: config.sslVerify, connectTimeout: 10_000 });
  client.on('error', () => undefined);
  await new Promise<void>((resolve, reject) => client.connect((err) => (err ? reject(err) : resolve())));
  const exec = (sql: string) => new Promise<unknown[][] & { metadata?: ColumnMetadata[] }>((resolve, reject) => client.exec(sql, { rowsAsArray: true }, (err, rows) => (err ? reject(err) : resolve((Array.isArray(rows) ? rows : []) as unknown[][] & { metadata?: ColumnMetadata[] }))));
  await exec('SET TRANSACTION READ ONLY').catch(() => undefined);
  return {
    query: async (sql) => {
      const rows = await exec(sql);
      const fields: HanaField[] = (rows.metadata ?? []).map((m) => ({ name: m.columnDisplayName ?? m.columnName, dataType: m.dataType, ...(m.fraction !== undefined ? { fraction: m.fraction } : {}), ...(m.length !== undefined ? { length: m.length } : {}) }));
      return { rows: rows.map((row) => row.map((v) => (Buffer.isBuffer(v) ? new Uint8Array(v) : v))), fields };
    },
    end: async () => client.end(),
  };
};

type Row = Record<string, unknown>;

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const qualified = (t: { schema?: string; name: string }) => (t.schema ? `${quote(t.schema)}.${quote(t.name)}` : quote(t.name));

/** The settings as a client config. The secret is the password. */
export function hanaConfigFor(ctx: ConnectorContext): HanaConfig {
  const s = ctx.connection.settings;
  const host = String(s.host ?? '').trim();
  const user = String(s.user ?? '').trim();
  if (!host) throw new ConnectorError('Give the database host.');
  if (!user) throw new ConnectorError('Give the user name.');
  const database = String(s.database ?? '').trim();
  return { host, port: Number(s.port) || 39015, ...(database ? { database } : {}), user, ...(ctx.secret !== undefined ? { password: ctx.secret } : {}), ssl: s.ssl !== false && s.ssl !== 'false', sslVerify: s.sslVerify !== false && s.sslVerify !== 'false' };
}

/** A node-hdb failure in plain words, without echoing anything secret. */
export function hanaProblem(e: unknown, config: HanaConfig): ConnectorError {
  if (e instanceof ConnectorError) return e;
  const err = e as { code?: string | number; message?: string };
  const message = err.message ?? String(e);
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHDBCLOSE|timed out|socket hang up/i.test(`${err.code ?? ''} ${message}`)) return new ConnectorError(`Nothing answers at ${config.host}:${config.port}.`);
  if (/certificate|CERT_|self[- ]signed/i.test(message)) return new ConnectorError(`${config.host}’s certificate isn’t trusted.`);
  if (err.code === 10 || /authentication failed|invalid username or password/i.test(message)) return new ConnectorError('The database refused the user name or password.');
  if (/No authentication method found/i.test(message)) return new ConnectorError('The database and the client agree on no way to sign in.');
  if (/database .* does not exist|unknown database/i.test(message)) return new ConnectorError(`There is no database called ${config.database ?? ''} at ${config.host}:${config.port}.`);
  if (err.code === 258 || /insufficient privilege/i.test(message)) return new ConnectorError(`The user may not read that: ${message}`);
  if (/read-only transaction|read only/i.test(message)) return new ConnectorError('The connection is read-only, so that statement can’t run.');
  return new ConnectorError(`The database answered: ${message.replace(/^SQL error, server error code: \d+\. /, '')}`);
}

/** The server's version in short: "SAP HANA 2.00.076". */
export function shortVersion(version: string): string {
  const m = /^(\d+\.\d+\.\d+)/.exec(version.trim());
  return `SAP HANA ${m ? m[1] : version.trim()}`;
}

export const VERSION_SQL = 'SELECT VERSION FROM SYS.M_DATABASE';
export const COUNT_SQL = 'SELECT (SELECT COUNT(*) FROM SYS.TABLES WHERE SCHEMA_NAME = CURRENT_SCHEMA) + (SELECT COUNT(*) FROM SYS.VIEWS WHERE SCHEMA_NAME = CURRENT_SCHEMA) AS N FROM DUMMY';
export const TABLES_SQL = 'SELECT t.TABLE_NAME, m.RECORD_COUNT, t.COMMENTS FROM SYS.TABLES t LEFT JOIN SYS.M_TABLES m ON m.SCHEMA_NAME = t.SCHEMA_NAME AND m.TABLE_NAME = t.TABLE_NAME WHERE t.SCHEMA_NAME = CURRENT_SCHEMA ORDER BY t.TABLE_NAME';
export const VIEWS_SQL = 'SELECT VIEW_NAME, DEFINITION, COMMENTS FROM SYS.VIEWS WHERE SCHEMA_NAME = CURRENT_SCHEMA ORDER BY VIEW_NAME';
export const COLUMNS_SQL = 'SELECT TABLE_NAME, COLUMN_NAME, POSITION, DATA_TYPE_NAME, LENGTH, SCALE, IS_NULLABLE, DEFAULT_VALUE, COMMENTS, GENERATION_TYPE FROM SYS.TABLE_COLUMNS WHERE SCHEMA_NAME = CURRENT_SCHEMA ORDER BY TABLE_NAME, POSITION';
export const VIEW_COLUMNS_SQL = 'SELECT VIEW_NAME AS TABLE_NAME, COLUMN_NAME, POSITION, DATA_TYPE_NAME, LENGTH, SCALE, IS_NULLABLE, COMMENTS FROM SYS.VIEW_COLUMNS WHERE SCHEMA_NAME = CURRENT_SCHEMA ORDER BY VIEW_NAME, POSITION';
export const CONSTRAINTS_SQL = 'SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, POSITION, IS_PRIMARY_KEY, IS_UNIQUE_KEY FROM SYS.CONSTRAINTS WHERE SCHEMA_NAME = CURRENT_SCHEMA ORDER BY TABLE_NAME, CONSTRAINT_NAME, POSITION';
export const REFS_SQL = 'SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, POSITION, REFERENCED_SCHEMA_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM SYS.REFERENTIAL_CONSTRAINTS WHERE SCHEMA_NAME = CURRENT_SCHEMA ORDER BY TABLE_NAME, CONSTRAINT_NAME, POSITION';
export const INDEXES_SQL = 'SELECT i.TABLE_NAME, i.INDEX_NAME, i.CONSTRAINT, c.COLUMN_NAME, c.POSITION FROM SYS.INDEXES i JOIN SYS.INDEX_COLUMNS c ON c.SCHEMA_NAME = i.SCHEMA_NAME AND c.TABLE_NAME = i.TABLE_NAME AND c.INDEX_NAME = i.INDEX_NAME WHERE i.SCHEMA_NAME = CURRENT_SCHEMA ORDER BY i.TABLE_NAME, i.INDEX_NAME, c.POSITION';

export interface TableRow extends Row {
  TABLE_NAME: string;
  RECORD_COUNT?: number | string | null;
  COMMENTS?: string | null;
}
export interface ViewRow extends Row {
  VIEW_NAME: string;
  DEFINITION?: string | null;
  COMMENTS?: string | null;
}
export interface ColumnRow extends HanaColumnRow, Row {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  IS_NULLABLE?: string | boolean | null;
  DEFAULT_VALUE?: string | null;
  COMMENTS?: string | null;
  GENERATION_TYPE?: string | null;
}

const yes = (v: unknown) => v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';

/** The catalogue: tables and views with their declared columns. */
export function catalogFromRows(tables: TableRow[], views: ViewRow[], columns: ColumnRow[]): Catalog {
  const byTable = new Map<string, ColumnRow[]>();
  for (const c of columns) byTable.set(c.TABLE_NAME, [...(byTable.get(c.TABLE_NAME) ?? []), c]);
  const cols = (name: string) => (byTable.get(name) ?? []).map((c) => ({ name: c.COLUMN_NAME, type: hanaColumnType(c).sqlType, nullable: yes(c.IS_NULLABLE) }));
  return {
    tables: [
      ...tables.map((t): CatalogTable => ({ name: t.TABLE_NAME, kind: 'table', ...(t.RECORD_COUNT !== null && t.RECORD_COUNT !== undefined ? { rows: Number(t.RECORD_COUNT) } : {}), columns: cols(t.TABLE_NAME) })),
      ...views.map((v): CatalogTable => ({ name: v.VIEW_NAME, kind: 'view', columns: cols(v.VIEW_NAME) })),
    ],
  };
}

export interface DetailRows {
  tables: TableRow[];
  views: ViewRow[];
  columns: ColumnRow[];
  viewColumns: ColumnRow[];
  constraints: Row[];
  refs: Row[];
  indexes: Row[];
}

/** The schema in detail, driver-neutral. */
export function detailFromRows(r: DetailRows): CatalogDetail {
  const str = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
  const pks = new Map<string, string[]>();
  const uniques = new Map<string, Map<string, string[]>>();
  for (const c of r.constraints) {
    const table = String(c.TABLE_NAME);
    if (yes(c.IS_PRIMARY_KEY)) pks.set(table, [...(pks.get(table) ?? []), String(c.COLUMN_NAME)]);
    else if (yes(c.IS_UNIQUE_KEY)) {
      const m = uniques.get(table) ?? new Map<string, string[]>();
      m.set(String(c.CONSTRAINT_NAME), [...(m.get(String(c.CONSTRAINT_NAME)) ?? []), String(c.COLUMN_NAME)]);
      uniques.set(table, m);
    }
  }
  const fks = new Map<string, Map<string, DocForeignKey>>();
  for (const x of r.refs) {
    const table = String(x.TABLE_NAME);
    const m = fks.get(table) ?? new Map<string, DocForeignKey>();
    const fk = m.get(String(x.CONSTRAINT_NAME)) ?? { name: String(x.CONSTRAINT_NAME), columns: [], refTable: String(x.REFERENCED_TABLE_NAME), refColumns: [] };
    fk.columns.push(String(x.COLUMN_NAME));
    fk.refColumns.push(String(x.REFERENCED_COLUMN_NAME));
    m.set(fk.name!, fk);
    fks.set(table, m);
  }
  const indexes = new Map<string, Map<string, DocIndex>>();
  for (const x of r.indexes) {
    // Key and unique constraints have indexes of their own; those are said on the columns.
    if (x.CONSTRAINT !== null && x.CONSTRAINT !== undefined && String(x.CONSTRAINT) !== '') continue;
    const table = String(x.TABLE_NAME);
    const m = indexes.get(table) ?? new Map<string, DocIndex>();
    const ix = m.get(String(x.INDEX_NAME)) ?? { name: String(x.INDEX_NAME), columns: [], unique: false };
    ix.columns.push(String(x.COLUMN_NAME));
    m.set(ix.name!, ix);
    indexes.set(table, m);
  }
  const columnsOf = (name: string, rows: ColumnRow[]): DocColumn[] => {
    const pk = pks.get(name) ?? [];
    const singleUniques = new Set([...(uniques.get(name)?.values() ?? [])].filter((cols) => cols.length === 1).map((cols) => cols[0]!));
    return rows
      .filter((c) => c.TABLE_NAME === name)
      .map((c) => {
        const isPk = pk.includes(c.COLUMN_NAME);
        const dflt = str(c.DEFAULT_VALUE);
        return { name: c.COLUMN_NAME, type: hanaColumnType(c).declared, pk: isPk, unique: (isPk && pk.length === 1) || singleUniques.has(c.COLUMN_NAME), notNull: !yes(c.IS_NULLABLE) || isPk, increment: /IDENTITY/i.test(String(c.GENERATION_TYPE ?? '')), ...(dflt !== undefined ? { default: dflt } : {}), ...(c.COMMENTS ? { note: String(c.COMMENTS) } : {}) };
      });
  };
  return {
    tables: [
      ...r.tables.map((t): DocTable => ({
        name: t.TABLE_NAME,
        kind: 'table',
        ...(t.COMMENTS ? { note: String(t.COMMENTS) } : {}),
        columns: columnsOf(t.TABLE_NAME, r.columns),
        indexes: [...[...(uniques.get(t.TABLE_NAME)?.entries() ?? [])].filter(([, cols]) => cols.length > 1).map(([name, cols]) => ({ name, columns: cols, unique: true })), ...(indexes.get(t.TABLE_NAME)?.values() ?? [])],
        foreignKeys: [...(fks.get(t.TABLE_NAME)?.values() ?? [])],
      })),
      ...r.views.map((v): DocTable => ({ name: v.VIEW_NAME, kind: 'view', ...(v.COMMENTS ? { note: String(v.COMMENTS) } : {}), columns: columnsOf(v.VIEW_NAME, r.viewColumns), indexes: [], foreignKeys: [], ...(v.DEFINITION ? { sql: String(v.DEFINITION) } : {}) })),
    ],
    enums: [],
  };
}

/** A result as sheet columns typed from the columns node-hdb describes. */
export function sheetFromResult(fields: HanaField[], rows: unknown[][]): { columns: SheetColumn[]; sqlTypes: string[] } {
  const types = fields.map(hanaFieldType);
  return {
    columns: fields.map((f, i) => ({ name: f.name, type: types[i]!.type, values: rows.map((row) => convertHanaValue(row[i], types[i]!.type)) })),
    sqlTypes: types.map((t) => t.sqlType),
  };
}

/** The SQL a read runs: a table is SELECT * over it; a query runs as written inside a derived table, bounded by LIMIT. */
export function readSql(req: ReadRequest): string {
  const limit = req.limit ? Math.max(1, Math.floor(req.limit)) : undefined;
  if (req.table) return `SELECT * FROM ${qualified(req.table)}${limit ? ` LIMIT ${limit}` : ''}`;
  const query = (req.query ?? '').trim().replace(/;\s*$/, '');
  return limit ? `SELECT * FROM (${query}) AS q LIMIT ${limit}` : query;
}

const objects = async (client: HanaClientLike, sql: string): Promise<Row[]> => {
  const r = await client.query(sql);
  return r.rows.map((row) => Object.fromEntries(r.fields.map((f, i) => [f.name, row[i]])));
};

/** Run a catalogue query, or nothing when the user may not read what it reads. */
async function maybe(client: HanaClientLike, sql: string): Promise<Row[]> {
  try {
    return await objects(client, sql);
  } catch (e) {
    if (/insufficient privilege|could not find table|invalid table name/i.test(e instanceof Error ? e.message : String(e))) return [];
    throw e;
  }
}

export function hanaConnector(connect: HanaConnect = hanaConnect): Connector {
  const withClient = async <T>(ctx: ConnectorContext, fn: (client: HanaClientLike) => Promise<T>): Promise<T> => {
    const config = hanaConfigFor(ctx);
    let client: HanaClientLike;
    try {
      client = await connect(config);
    } catch (e) {
      throw hanaProblem(e, config);
    }
    const stop = () => void client.end().catch(() => undefined);
    // Cancelled while connecting: nothing more to do.
    if (ctx.signal?.aborted) {
      stop();
      throw new ConnectorError('The read was cancelled.');
    }
    ctx.signal?.addEventListener('abort', stop);
    try {
      return await fn(client);
    } catch (e) {
      if (ctx.signal?.aborted) throw new ConnectorError('The read was cancelled.');
      throw hanaProblem(e, config);
    } finally {
      ctx.signal?.removeEventListener('abort', stop);
      await client.end().catch(() => undefined);
    }
  };
  return {
    id: 'hana',
    runsIn: ['local', 'pi'],
    test: (ctx): Promise<TestOutcome> =>
      withClient(ctx, async (client) => {
        const version = String((await maybe(client, VERSION_SQL))[0]?.VERSION ?? '');
        const n = Number((await objects(client, COUNT_SQL))[0]?.N ?? 0);
        return { ok: true, server: `${shortVersion(version)}, ${n} ${n === 1 ? 'table' : 'tables'}` };
      }),
    catalog: (ctx) => withClient(ctx, async (client) => catalogFromRows((await objects(client, TABLES_SQL)) as TableRow[], (await maybe(client, VIEWS_SQL)) as ViewRow[], (await objects(client, COLUMNS_SQL)).concat(await maybe(client, VIEW_COLUMNS_SQL)) as ColumnRow[])),
    document: (ctx) =>
      withClient(ctx, async (client) =>
        detailFromRows({
          tables: (await objects(client, TABLES_SQL)) as TableRow[],
          views: (await maybe(client, VIEWS_SQL)) as ViewRow[],
          columns: (await objects(client, COLUMNS_SQL)) as ColumnRow[],
          viewColumns: (await maybe(client, VIEW_COLUMNS_SQL)) as ColumnRow[],
          constraints: await maybe(client, CONSTRAINTS_SQL),
          refs: await maybe(client, REFS_SQL),
          indexes: await maybe(client, INDEXES_SQL),
        }),
      ),
    read: (ctx, req): Promise<ReadResult> =>
      withClient(ctx, async (client) => {
        if (!req.table && !req.query) throw new ConnectorError('Choose a table or write a query.');
        if (req.query) {
          const problem = statementProblem(req.query);
          if (problem) throw new ConnectorError(problem);
        }
        const r = await client.query(readSql(req));
        const { columns, sqlTypes } = sheetFromResult(r.fields, r.rows);
        return { ipc: sheetToIPC(columns), columns: columns.map((c, i) => ({ name: c.name, sqlType: sqlTypes[i]! })), rows: r.rows.length };
      }),
  };
}
