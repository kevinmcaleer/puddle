// Oracle Database, read with node-oracledb in thin mode (pure JavaScript, no client install) in puddle-connect and
// the runner. Each request starts a read-only transaction, NUMBER values arrive as text so no digit is lost, dates as
// wall-clock text, LOBs whole, and the catalogue comes from the ALL_* views for the session's current schema
// (ALL_TABLES, ALL_VIEWS, ALL_TAB_COLUMNS, ALL_CONSTRAINTS with ALL_CONS_COLUMNS, ALL_INDEXES with ALL_IND_COLUMNS,
// ALL_TAB_COMMENTS and ALL_COL_COMMENTS), each part on its own so a lesser grant still documents the rest. Unquoted
// Oracle names are upper case, and that is how they are listed. The SQL here is Oracle's own dialect, not DuckDB's.
import { sheetToIPC } from '../../excel/arrow';
import type { SheetColumn } from '../../excel/types';
import type { Catalog, CatalogTable } from '../../model';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocColumn, type DocForeignKey, type DocIndex, type DocTable, type ReadRequest, type ReadResult, type TestOutcome } from '../types';
import { convertOracleValue, localText, oracleColumnType, oracleFieldType, type OracleColumnRow, type OracleField } from './oracleTypes';
export type { OracleField } from './oracleTypes';

/** What the driver asks of a client: one statement at a time, rows as arrays of plain values, so tests can stand in for it. */
export interface OracleClientLike {
  query(sql: string): Promise<{ rows: unknown[][]; fields: OracleField[] }>;
  end(): Promise<void>;
}

export interface OracleConfig {
  host: string;
  port: number;
  service: string;
  user: string;
  password?: string;
}

export type OracleConnect = (config: OracleConfig) => Promise<OracleClientLike>;

/** node-oracledb's value for a column, made plain: dates as wall-clock text (an instant with a zone as ISO text), bytes as bytes. */
export function plainValue(dbTypeName: string, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return dbTypeName === 'TIMESTAMP WITH TIME ZONE' ? v.toISOString() : localText(v);
  if (Buffer.isBuffer(v)) return new Uint8Array(v);
  return v;
}

/** Connects with node-oracledb and opens a read-only transaction. */
export const oracleConnect: OracleConnect = async (config) => {
  const oracledb = (await import('oracledb')).default;
  const conn = await oracledb.getConnection({ user: config.user, password: config.password ?? '', connectString: `${config.host}:${config.port}/${config.service}`, connectTimeout: 10 });
  const asString = new Set([oracledb.DB_TYPE_NUMBER.num, oracledb.DB_TYPE_CLOB.num, oracledb.DB_TYPE_NCLOB.num, oracledb.DB_TYPE_INTERVAL_DS.num, oracledb.DB_TYPE_INTERVAL_YM.num]);
  const asBuffer = new Set([oracledb.DB_TYPE_BLOB.num, oracledb.DB_TYPE_LONG_RAW.num]);
  const options = {
    outFormat: oracledb.OUT_FORMAT_ARRAY,
    fetchTypeHandler: (m: { dbType?: { num: number } }) => (m.dbType && asString.has(m.dbType.num) ? { type: oracledb.STRING } : m.dbType && asBuffer.has(m.dbType.num) ? { type: oracledb.BUFFER } : undefined),
  };
  await conn.execute('SET TRANSACTION READ ONLY').catch(() => undefined);
  return {
    query: async (sql) => {
      const r = await conn.execute(sql, [], options);
      const fields: OracleField[] = (r.metaData ?? []).map((m) => ({ name: m.name, dbTypeName: m.dbTypeName ?? m.dbType?.columnTypeName ?? '', ...(m.precision !== undefined ? { precision: m.precision } : {}), ...(m.scale !== undefined ? { scale: m.scale } : {}), ...(m.byteSize !== undefined ? { byteSize: m.byteSize } : {}) }));
      return { rows: (r.rows ?? []).map((row) => row.map((v, i) => plainValue(fields[i]?.dbTypeName ?? '', v))), fields };
    },
    end: () => conn.close(),
  };
};

type Row = Record<string, unknown>;

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const qualified = (t: { schema?: string; name: string }) => (t.schema ? `${quote(t.schema)}.${quote(t.name)}` : quote(t.name));

/** The settings as a client config. The secret is the password. */
export function oracleConfigFor(ctx: ConnectorContext): OracleConfig {
  const s = ctx.connection.settings;
  const host = String(s.host ?? '').trim();
  const service = String(s.service ?? '').trim();
  const user = String(s.user ?? '').trim();
  if (!host) throw new ConnectorError('Give the database host.');
  if (!service) throw new ConnectorError('Give the service name.');
  if (!user) throw new ConnectorError('Give the user name.');
  return { host, port: Number(s.port) || 1521, service, user, ...(ctx.secret !== undefined ? { password: ctx.secret } : {}) };
}

/** A node-oracledb failure in plain words, without echoing anything secret. */
export function oracleProblem(e: unknown, config: OracleConfig): ConnectorError {
  if (e instanceof ConnectorError) return e;
  const err = e as { code?: string; errorNum?: number; message?: string };
  const message = err.message ?? String(e);
  if (err.code === 'NJS-510' || err.code === 'NJS-511' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || /ECONNREFUSED|ENOTFOUND|NJS-510|NJS-511|NJS-503|timed out|connection refused/i.test(message)) return new ConnectorError(`Nothing answers at ${config.host}:${config.port}.`);
  if (err.errorNum === 1017 || /ORA-01017/.test(message)) return new ConnectorError('The database refused the user name or password.');
  if (err.errorNum === 12514 || err.errorNum === 12505 || /ORA-12514|ORA-12505|NJS-518/.test(message)) return new ConnectorError(`There is no service called ${config.service} at ${config.host}:${config.port}.`);
  if (err.errorNum === 1456 || /ORA-01456/.test(message)) return new ConnectorError('The connection is read-only, so that statement can’t run.');
  return new ConnectorError(`The database answered: ${message}`);
}

/** The server's version in short: "Oracle Database 23.0.0". */
export function shortVersion(version: string): string {
  const m = /(\d+\.\d+\.\d+)/.exec(version);
  return `Oracle Database ${m ? m[1] : version.trim()}`;
}

const objects = async (client: OracleClientLike, sql: string): Promise<Row[]> => {
  const r = await client.query(sql);
  return r.rows.map((row) => Object.fromEntries(r.fields.map((f, i) => [f.name, row[i]])));
};

/** Run a catalogue query, or nothing when the user may not read what it reads. */
async function maybe(client: OracleClientLike, sql: string): Promise<Row[]> {
  try {
    return await objects(client, sql);
  } catch {
    return [];
  }
}

const OWN = "OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')";
export const TABLES_SQL = `SELECT t.TABLE_NAME, t.NUM_ROWS, c.COMMENTS FROM ALL_TABLES t LEFT JOIN ALL_TAB_COMMENTS c ON c.OWNER = t.OWNER AND c.TABLE_NAME = t.TABLE_NAME WHERE t.${OWN} ORDER BY t.TABLE_NAME`;
export const VIEWS_SQL = `SELECT v.VIEW_NAME, v.TEXT_VC AS TEXT, c.COMMENTS FROM ALL_VIEWS v LEFT JOIN ALL_TAB_COMMENTS c ON c.OWNER = v.OWNER AND c.TABLE_NAME = v.VIEW_NAME WHERE v.${OWN} ORDER BY v.VIEW_NAME`;
export const VIEWS_LONG_SQL = `SELECT v.VIEW_NAME, v.TEXT, c.COMMENTS FROM ALL_VIEWS v LEFT JOIN ALL_TAB_COMMENTS c ON c.OWNER = v.OWNER AND c.TABLE_NAME = v.VIEW_NAME WHERE v.${OWN} ORDER BY v.VIEW_NAME`;
export const COLUMNS_SQL = `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_ID, DATA_TYPE, DATA_LENGTH, CHAR_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE, DATA_DEFAULT FROM ALL_TAB_COLUMNS WHERE ${OWN} ORDER BY TABLE_NAME, COLUMN_ID`;
export const IDENTITY_SQL = `SELECT TABLE_NAME, COLUMN_NAME FROM ALL_TAB_IDENTITY_COLS WHERE ${OWN}`;
export const COLUMN_NOTES_SQL = `SELECT TABLE_NAME, COLUMN_NAME, COMMENTS FROM ALL_COL_COMMENTS WHERE ${OWN} AND COMMENTS IS NOT NULL`;
export const CONSTRAINTS_SQL = `SELECT c.CONSTRAINT_NAME, c.CONSTRAINT_TYPE, c.TABLE_NAME, c.R_CONSTRAINT_NAME, c.INDEX_NAME, cc.COLUMN_NAME, cc.POSITION FROM ALL_CONSTRAINTS c JOIN ALL_CONS_COLUMNS cc ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME WHERE c.${OWN} AND c.CONSTRAINT_TYPE IN ('P', 'R', 'U') ORDER BY c.TABLE_NAME, c.CONSTRAINT_NAME, cc.POSITION`;
export const INDEXES_SQL = `SELECT i.INDEX_NAME, i.TABLE_NAME, i.UNIQUENESS, ic.COLUMN_NAME, ic.COLUMN_POSITION FROM ALL_INDEXES i JOIN ALL_IND_COLUMNS ic ON ic.INDEX_OWNER = i.OWNER AND ic.INDEX_NAME = i.INDEX_NAME WHERE i.${OWN} ORDER BY i.TABLE_NAME, i.INDEX_NAME, ic.COLUMN_POSITION`;
const VERSION_SQL = 'SELECT VERSION FROM PRODUCT_COMPONENT_VERSION WHERE ROWNUM = 1';
const COUNT_SQL = `SELECT count(*) AS N FROM ALL_OBJECTS WHERE ${OWN} AND OBJECT_TYPE IN ('TABLE', 'VIEW')`;

export interface TableRow extends Row {
  TABLE_NAME: string;
  NUM_ROWS?: unknown;
  COMMENTS?: string | null;
}

export interface ViewRow extends Row {
  VIEW_NAME: string;
  TEXT: string | null;
  COMMENTS?: string | null;
}

export interface ColumnRow extends OracleColumnRow, Row {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  NULLABLE: string;
  DATA_DEFAULT: string | null;
}

/** A default as DBML wants it: Oracle keeps the expression as written, with trailing space. */
export function oracleDefault(d: string | null | undefined): string | undefined {
  if (d === null || d === undefined) return undefined;
  const v = d.trim();
  return !v || /^NULL$/i.test(v) ? undefined : v;
}

/** The catalogue's tables and views from the ALL_* rows. */
export function catalogFromRows(tables: TableRow[], views: ViewRow[], columns: ColumnRow[]): Catalog {
  const byTable = new Map<string, ColumnRow[]>();
  for (const c of columns) byTable.set(c.TABLE_NAME, [...(byTable.get(c.TABLE_NAME) ?? []), c]);
  const cols = (name: string) => (byTable.get(name) ?? []).map((c) => ({ name: c.COLUMN_NAME, type: oracleColumnType(c).sqlType, nullable: c.NULLABLE !== 'N' }));
  return {
    tables: [
      ...tables.map((t): CatalogTable => {
        const n = Number(t.NUM_ROWS);
        return { name: t.TABLE_NAME, kind: 'table', columns: cols(t.TABLE_NAME), ...(n > 0 ? { rows: n } : {}) };
      }),
      ...views.map((v): CatalogTable => ({ name: v.VIEW_NAME, kind: 'view', columns: cols(v.VIEW_NAME) })),
    ],
  };
}

export interface DetailRows {
  tables: TableRow[];
  views: ViewRow[];
  columns: ColumnRow[];
  identity?: Row[];
  columnNotes?: Row[];
  constraints?: Row[];
  indexes?: Row[];
}

/** The schema in detail from the ALL_* rows: pure, so it is checked without a server. */
export function detailFromRows(r: DetailRows): CatalogDetail {
  const columnsOf = new Map<string, ColumnRow[]>();
  for (const c of r.columns) columnsOf.set(c.TABLE_NAME, [...(columnsOf.get(c.TABLE_NAME) ?? []), c]);
  const identity = new Set((r.identity ?? []).map((i) => `${String(i.TABLE_NAME)}.${String(i.COLUMN_NAME)}`));
  const notes = new Map((r.columnNotes ?? []).map((n) => [`${String(n.TABLE_NAME)}.${String(n.COLUMN_NAME)}`, String(n.COMMENTS ?? '')]));
  // Constraints with their columns in order; a foreign key names the primary or unique constraint it references.
  const constraints = new Map<string, { kind: string; table: string; ref?: string; index?: string; columns: string[] }>();
  for (const c of r.constraints ?? []) {
    const name = String(c.CONSTRAINT_NAME);
    const k = constraints.get(name) ?? { kind: String(c.CONSTRAINT_TYPE), table: String(c.TABLE_NAME), ...(c.R_CONSTRAINT_NAME ? { ref: String(c.R_CONSTRAINT_NAME) } : {}), ...(c.INDEX_NAME ? { index: String(c.INDEX_NAME) } : {}), columns: [] };
    k.columns.push(String(c.COLUMN_NAME));
    constraints.set(name, k);
  }
  const backing = new Set([...constraints.values()].map((c) => c.index).filter(Boolean));
  const indexes = new Map<string, { table: string; unique: boolean; columns: string[] }>();
  for (const i of r.indexes ?? []) {
    const name = String(i.INDEX_NAME);
    const index = indexes.get(name) ?? { table: String(i.TABLE_NAME), unique: String(i.UNIQUENESS) === 'UNIQUE', columns: [] };
    index.columns.push(String(i.COLUMN_NAME));
    indexes.set(name, index);
  }
  const table = (name: string, kind: 'table' | 'view', note: string | null | undefined, sql?: string | null): DocTable => {
    const own = [...constraints.entries()].filter(([, c]) => c.table === name);
    const pk = own.find(([, c]) => c.kind === 'P')?.[1].columns ?? [];
    const uniques = own.filter(([, c]) => c.kind === 'U').map(([n, c]) => ({ name: n, columns: c.columns }));
    const single = new Set(uniques.filter((u) => u.columns.length === 1).map((u) => u.columns[0]!));
    const columns = (columnsOf.get(name) ?? []).map((c): DocColumn => {
      const d = oracleDefault(c.DATA_DEFAULT);
      const note = notes.get(`${name}.${c.COLUMN_NAME}`);
      return {
        name: c.COLUMN_NAME,
        type: oracleColumnType(c).declared,
        pk: pk.length === 1 && pk[0] === c.COLUMN_NAME,
        unique: single.has(c.COLUMN_NAME),
        notNull: c.NULLABLE === 'N',
        increment: identity.has(`${name}.${c.COLUMN_NAME}`),
        ...(d !== undefined ? { default: d } : {}),
        ...(note ? { note } : {}),
      };
    });
    const foreignKeys = own
      .filter(([, c]) => c.kind === 'R')
      .map(([n, c]): DocForeignKey => {
        const target = c.ref ? constraints.get(c.ref) : undefined;
        return { name: n, columns: c.columns, refTable: target?.table ?? '', refColumns: target?.columns ?? [] };
      })
      .filter((fk) => fk.refTable);
    const others = [...indexes.entries()].filter(([n, i]) => i.table === name && !backing.has(n)).map(([n, i]): DocIndex => ({ name: n, columns: i.columns, unique: i.unique }));
    return {
      name,
      kind,
      ...(note ? { note } : {}),
      columns,
      indexes: [...(pk.length > 1 ? [{ columns: pk, unique: true } satisfies DocIndex] : []), ...uniques.filter((u) => u.columns.length > 1).map((u): DocIndex => ({ name: u.name, columns: u.columns, unique: true })), ...others],
      foreignKeys,
      ...(sql ? { sql: sql.trim() } : {}),
    };
  };
  return {
    tables: [...r.tables.map((t) => table(t.TABLE_NAME, 'table', t.COMMENTS)), ...r.views.map((v) => table(v.VIEW_NAME, 'view', v.COMMENTS, v.TEXT))],
    enums: [],
  };
}

/** A read's rows as sheet columns typed from the result's fields. */
export function sheetFromResult(fields: OracleField[], rows: unknown[][]): { columns: SheetColumn[]; sqlTypes: string[] } {
  const types = fields.map(oracleFieldType);
  return {
    columns: fields.map((f, i) => ({ name: f.name, type: types[i]!.type, values: rows.map((row) => convertOracleValue(row[i], types[i]!.type)) })),
    sqlTypes: types.map((t) => t.sqlType),
  };
}

/** The SQL a read runs: a table whole, or the query as an inline view, with the limit on the outside. */
export function readSql(req: ReadRequest): string {
  const inner = req.table ? `SELECT * FROM ${qualified(req.table)}` : `SELECT * FROM (${(req.query ?? '').trim().replace(/;\s*$/, '')}) puddle_query`;
  return req.limit ? `${inner} FETCH FIRST ${Math.max(1, Math.floor(req.limit))} ROWS ONLY` : inner;
}

export function oracleConnector(connect: OracleConnect = oracleConnect): Connector {
  const withClient = async <T>(ctx: ConnectorContext, fn: (client: OracleClientLike) => Promise<T>): Promise<T> => {
    const config = oracleConfigFor(ctx);
    let client: OracleClientLike;
    try {
      client = await connect(config);
    } catch (e) {
      throw oracleProblem(e, config);
    }
    const stop = () => void client.end().catch(() => undefined);
    ctx.signal?.addEventListener('abort', stop);
    try {
      return await fn(client);
    } catch (e) {
      if (ctx.signal?.aborted) throw new ConnectorError('The read was cancelled.');
      throw oracleProblem(e, config);
    } finally {
      ctx.signal?.removeEventListener('abort', stop);
      await client.end().catch(() => undefined);
    }
  };
  const views = async (client: OracleClientLike): Promise<ViewRow[]> => {
    const modern = await maybe(client, VIEWS_SQL);
    return (modern.length ? modern : await maybe(client, VIEWS_LONG_SQL)) as ViewRow[];
  };
  return {
    id: 'oracle',
    runsIn: ['local', 'pi'],
    test: (ctx): Promise<TestOutcome> =>
      withClient(ctx, async (client) => {
        const version = String((await maybe(client, VERSION_SQL))[0]?.VERSION ?? '');
        const n = Number((await objects(client, COUNT_SQL))[0]?.N ?? 0);
        return { ok: true, server: `${shortVersion(version)}, ${n} ${n === 1 ? 'table' : 'tables'}` };
      }),
    catalog: (ctx) => withClient(ctx, async (client) => catalogFromRows((await objects(client, TABLES_SQL)) as TableRow[], await views(client), (await objects(client, COLUMNS_SQL)) as ColumnRow[])),
    document: (ctx) =>
      withClient(ctx, async (client) =>
        detailFromRows({
          tables: (await objects(client, TABLES_SQL)) as TableRow[],
          views: await views(client),
          columns: (await objects(client, COLUMNS_SQL)) as ColumnRow[],
          identity: await maybe(client, IDENTITY_SQL),
          columnNotes: await maybe(client, COLUMN_NOTES_SQL),
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
