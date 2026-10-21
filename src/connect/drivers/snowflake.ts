// Snowflake, read over its SQL REST API with fetch from puddle-connect (the API doesn't let a browser in). The
// connection signs in with a key pair: a JWT signed with the private key, naming the account, the user and the
// public key's fingerprint, is sent with each statement. A statement is posted to /api/v2/statements; when it hasn't
// finished in the request's time the handle is polled, and a large answer is fetched partition by partition. The
// catalogue comes from the database's INFORMATION_SCHEMA with the keys from SHOW. Snowflake has no read-only
// session, so the user should carry a read-only role; the service's one-reading-statement rule guards the rest.
// The SQL here is Snowflake's own dialect, not DuckDB's.
import { sheetToIPC } from '../../excel/arrow';
import type { SheetColumn } from '../../excel/types';
import type { Catalog, CatalogTable } from '../../model';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocColumn, type DocForeignKey, type DocTable, type ReadRequest, type ReadResult, type TestOutcome } from '../types';
import { baseUrl, fetchProblem, hostOf, nowSeconds, pemBytes, publicKeyFingerprint, signJwt, type Fetch } from './http';
import { convertSnowflakeValue, snowflakeColumnType, snowflakeFieldType, type SnowflakeField } from './snowflakeTypes';

export interface SnowflakeConfig {
  /** The API's address: the account's own host unless the settings name another (PrivateLink, a stand-in). */
  url: string;
  account: string;
  user: string;
  warehouse?: string;
  database?: string;
  schema?: string;
  role?: string;
  /** The private key, PEM; absent only when the config is read for messages. */
  key?: string;
}

/** A statement's answer as the SQL API gives it. */
export interface StatementResponse {
  statementHandle?: string;
  resultSetMetaData?: { numRows?: number; format?: string; rowType: SnowflakeField[]; partitionInfo?: { rowCount: number }[] };
  data?: (string | null)[][];
  code?: string;
  message?: string;
  sqlState?: string;
}

export interface SnowflakeResult {
  fields: SnowflakeField[];
  rows: (string | null)[][];
}

/** A name as Snowflake resolves it: as written inside double quotes, otherwise in upper case. */
export function ident(name: string): string {
  const t = name.trim();
  return t.startsWith('"') && t.endsWith('"') && t.length > 1 ? t.slice(1, -1).replaceAll('""', '"') : t.toUpperCase();
}

/** The account as a JWT names it: the locator in upper case without its region and cloud (xy12345.eu-west-2.aws → XY12345); an org-account name as it is. */
export function jwtAccount(account: string): string {
  const t = account.trim();
  return (t.includes('.') ? t.split('.')[0]! : t).toUpperCase();
}

/** The settings as a config. The secret is the private key. */
export function snowflakeConfigFor(ctx: ConnectorContext, needKey = true): SnowflakeConfig {
  const s = ctx.connection.settings;
  const text = (k: string) => String(s[k] ?? '').trim();
  const account = text('account').replace(/\.snowflakecomputing\.com$/i, '');
  if (!account) throw new ConnectorError('Give the account.');
  const user = text('user');
  if (!user) throw new ConnectorError('Give the user name.');
  if (needKey && !ctx.secret?.trim()) throw new ConnectorError('Paste the private key to sign in.');
  if (needKey) pemBytes(ctx.secret!);
  const url = text('url') ? baseUrl(s.url) : `https://${account}.snowflakecomputing.com`;
  const optional = (k: string) => (text(k) ? { [k]: ident(text(k)) } : {});
  return { url, account, user: ident(user), ...optional('warehouse'), ...optional('database'), ...optional('schema'), ...optional('role'), ...(needKey ? { key: ctx.secret! } : {}) };
}

/** A Snowflake failure in plain words, without echoing anything secret. */
export function snowflakeProblem(status: number, body: StatementResponse | undefined, text: string, config: SnowflakeConfig): ConnectorError {
  // Snowflake's messages put the kind on the first line and the detail on the next: keep both, on one line.
  const message = (body?.message ?? '').trim().replace(/\s*\n\s*/g, ' ');
  if (status === 401 || /JWT token is invalid|Invalid JWT|not authorized to use this key/i.test(message)) return new ConnectorError(`Snowflake refused the key for ${config.user}.`);
  if (/No active warehouse selected/i.test(message)) return new ConnectorError('Give the warehouse to run on.');
  if (/Database '([^']+)' does not exist/i.test(message)) return new ConnectorError(`There is no database called ${/Database '([^']+)'/i.exec(message)![1]} in ${config.account}.`);
  if (status === 404 && !body) return new ConnectorError(`${hostOf(config.url)} didn’t answer as Snowflake does; check the address.`);
  if (!message && !body && text.trim() && !text.trim().startsWith('{')) return new ConnectorError(`${hostOf(config.url)} didn’t answer as Snowflake does; check the address.`);
  return new ConnectorError(`Snowflake answered: ${message || `status ${status}`}`);
}

type Row = Record<string, unknown>;

/** Rows as objects keyed by their column's name in upper case (INFORMATION_SCHEMA names are upper, SHOW's lower). */
const objects = (r: SnowflakeResult): Row[] => r.rows.map((row) => Object.fromEntries(r.fields.map((f, i) => [f.name.toUpperCase(), row[i]])));

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

const where = (config: SnowflakeConfig) => `WHERE table_schema <> 'INFORMATION_SCHEMA'${config.schema ? ` AND table_schema = ${literal(config.schema)}` : ''}`;
const needDatabase = (config: SnowflakeConfig): string => {
  if (!config.database) throw new ConnectorError('Give the database to read.');
  return quote(config.database);
};

export const VERSION_SQL = 'SELECT CURRENT_VERSION() AS version';
export const countSql = (config: SnowflakeConfig) => `SELECT COUNT(*) AS n FROM ${needDatabase(config)}.INFORMATION_SCHEMA.TABLES ${where(config)}`;
export const tablesSql = (config: SnowflakeConfig) => `SELECT table_schema, table_name, table_type, row_count, comment FROM ${needDatabase(config)}.INFORMATION_SCHEMA.TABLES ${where(config)} ORDER BY table_schema, table_name`;
export const columnsSql = (config: SnowflakeConfig) =>
  `SELECT table_schema, table_name, column_name, ordinal_position, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default, is_identity, comment FROM ${needDatabase(config)}.INFORMATION_SCHEMA.COLUMNS ${where(config)} ORDER BY table_schema, table_name, ordinal_position`;
export const viewsSql = (config: SnowflakeConfig) => `SELECT table_schema, table_name, view_definition FROM ${needDatabase(config)}.INFORMATION_SCHEMA.VIEWS ${where(config)}`;
/** SHOW … KEYS for the schema, or the whole database when the connection names none. */
export const showKeysSql = (config: SnowflakeConfig, kind: 'PRIMARY' | 'UNIQUE' | 'IMPORTED') => `SHOW ${kind} KEYS IN ${config.schema ? `SCHEMA ${needDatabase(config)}.${quote(config.schema)}` : `DATABASE ${needDatabase(config)}`}`;

export interface TableRow extends Row {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  TABLE_TYPE: string;
  ROW_COUNT: string | null;
  COMMENT: string | null;
}

export interface ColumnRow extends Row {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  CHARACTER_MAXIMUM_LENGTH: string | null;
  NUMERIC_PRECISION: string | null;
  NUMERIC_SCALE: string | null;
  IS_NULLABLE: string;
  COLUMN_DEFAULT: string | null;
  IS_IDENTITY: string;
  COMMENT: string | null;
}

/** The rows a catalogue is built from. */
export interface SchemaRows {
  tables: TableRow[];
  columns: ColumnRow[];
  views?: Row[];
  primary?: Row[];
  unique?: Row[];
  imported?: Row[];
}

const isView = (t: TableRow) => /VIEW/i.test(t.TABLE_TYPE);
const str = (v: unknown) => String(v ?? '');
/** The schema a table carries: none when it is the connection's. */
const schemaOf = (config: SnowflakeConfig, schema: string) => (config.schema === schema ? {} : { schema });

/** The catalogue's tables and views from the INFORMATION_SCHEMA rows. */
export function catalogFromRows(config: SnowflakeConfig, rows: SchemaRows): Catalog {
  const byTable = new Map<string, ColumnRow[]>();
  for (const c of rows.columns) byTable.set(`${c.TABLE_SCHEMA}.${c.TABLE_NAME}`, [...(byTable.get(`${c.TABLE_SCHEMA}.${c.TABLE_NAME}`) ?? []), c]);
  const out: CatalogTable[] = rows.tables.map((t) => {
    const n = t.ROW_COUNT === null || t.ROW_COUNT === undefined || isView(t) ? undefined : Number(t.ROW_COUNT);
    return {
      ...schemaOf(config, t.TABLE_SCHEMA),
      name: t.TABLE_NAME,
      kind: isView(t) ? 'view' : 'table',
      columns: (byTable.get(`${t.TABLE_SCHEMA}.${t.TABLE_NAME}`) ?? []).map((c) => ({ name: c.COLUMN_NAME, type: snowflakeColumnType(c).sqlType, nullable: c.IS_NULLABLE === 'YES' })),
      ...(n !== undefined && Number.isFinite(n) ? { rows: n } : {}),
    };
  });
  return { tables: out };
}

/** The documented schema: keys from SHOW, identity columns, defaults, comments and views. */
export function detailFromRows(config: SnowflakeConfig, rows: SchemaRows): CatalogDetail {
  const byTable = new Map<string, ColumnRow[]>();
  for (const c of rows.columns) byTable.set(`${c.TABLE_SCHEMA}.${c.TABLE_NAME}`, [...(byTable.get(`${c.TABLE_SCHEMA}.${c.TABLE_NAME}`) ?? []), c]);
  const views = new Map((rows.views ?? []).map((v) => [`${str(v.TABLE_SCHEMA)}.${str(v.TABLE_NAME)}`, str(v.VIEW_DEFINITION)]));
  const keyed = (list: Row[] | undefined, schema: string, table: string) => (list ?? []).filter((k) => str(k.SCHEMA_NAME) === schema && str(k.TABLE_NAME) === table);
  const out: DocTable[] = rows.tables.map((t) => {
    const key = `${t.TABLE_SCHEMA}.${t.TABLE_NAME}`;
    const pk = new Set(keyed(rows.primary, t.TABLE_SCHEMA, t.TABLE_NAME).map((k) => str(k.COLUMN_NAME)));
    const uniqueKeys = keyed(rows.unique, t.TABLE_SCHEMA, t.TABLE_NAME);
    const singles = new Set<string>();
    for (const name of new Set(uniqueKeys.map((k) => str(k.CONSTRAINT_NAME)))) {
      const cols = uniqueKeys.filter((k) => str(k.CONSTRAINT_NAME) === name);
      if (cols.length === 1) singles.add(str(cols[0]!.COLUMN_NAME));
    }
    const cols: DocColumn[] = (byTable.get(key) ?? []).map((c) => {
      const d = c.COLUMN_DEFAULT !== null && c.COLUMN_DEFAULT !== undefined && c.COLUMN_DEFAULT !== '' ? c.COLUMN_DEFAULT : undefined;
      return { name: c.COLUMN_NAME, type: snowflakeColumnType(c).declared, pk: pk.has(c.COLUMN_NAME), unique: singles.has(c.COLUMN_NAME), notNull: c.IS_NULLABLE !== 'YES', increment: c.IS_IDENTITY === 'YES', ...(d !== undefined ? { default: d } : {}), ...(c.COMMENT ? { note: c.COMMENT } : {}) };
    });
    const imported = (rows.imported ?? []).filter((k) => str(k.FK_SCHEMA_NAME) === t.TABLE_SCHEMA && str(k.FK_TABLE_NAME) === t.TABLE_NAME);
    const fks: DocForeignKey[] = [];
    for (const name of new Set(imported.map((k) => str(k.FK_NAME)))) {
      const parts = imported.filter((k) => str(k.FK_NAME) === name).sort((a, b) => Number(a.KEY_SEQUENCE) - Number(b.KEY_SEQUENCE));
      const refSchema = str(parts[0]!.PK_SCHEMA_NAME);
      fks.push({ name, columns: parts.map((k) => str(k.FK_COLUMN_NAME)), ...(config.schema === refSchema ? {} : { refSchema }), refTable: str(parts[0]!.PK_TABLE_NAME), refColumns: parts.map((k) => str(k.PK_COLUMN_NAME)) });
    }
    const uniques = [...new Set(uniqueKeys.map((k) => str(k.CONSTRAINT_NAME)))].map((name) => ({ name, columns: uniqueKeys.filter((k) => str(k.CONSTRAINT_NAME) === name).sort((a, b) => Number(a.KEY_SEQUENCE) - Number(b.KEY_SEQUENCE)).map((k) => str(k.COLUMN_NAME)), unique: true })).filter((u) => u.columns.length > 1);
    const sql = views.get(key);
    return { ...schemaOf(config, t.TABLE_SCHEMA), name: t.TABLE_NAME, kind: isView(t) ? 'view' : 'table', ...(t.COMMENT ? { note: t.COMMENT } : {}), columns: cols, indexes: uniques, foreignKeys: fks, ...(isView(t) && sql ? { sql } : {}) };
  });
  return { tables: out, enums: [] };
}

/** A result as the sheet the loader takes: columns typed from the result's metadata, values converted. */
export function sheetFromResult(r: SnowflakeResult): { columns: SheetColumn[]; sqlTypes: string[] } {
  const types = r.fields.map(snowflakeFieldType);
  const columns: SheetColumn[] = r.fields.map((f, i) => ({ name: f.name, type: types[i]!.type, values: r.rows.map((row) => convertSnowflakeValue(row[i], f)) }));
  return { columns, sqlTypes: types.map((t) => t.sqlType) };
}

/** The SQL a read runs: a table by its database, schema and name, or the query as a subquery, with the limit outside. */
export function readSql(config: SnowflakeConfig, req: ReadRequest): string {
  let inner: string;
  if (req.table) {
    const schema = req.table.schema ?? config.schema;
    if (!schema) throw new ConnectorError('Give the schema to read.');
    inner = `SELECT * FROM ${needDatabase(config)}.${quote(schema)}.${quote(req.table.name)}`;
  } else inner = `SELECT * FROM (${(req.query ?? '').trim().replace(/;\s*$/, '')}) AS puddle_query`;
  return req.limit ? `${inner} LIMIT ${Math.max(1, Math.floor(req.limit))}` : inner;
}

const LIFETIME = 59 * 60;

export function snowflakeConnector(fetchImpl: Fetch = fetch): Connector {
  /** Signed tokens by account, user and key, kept until shortly before they expire. */
  const tokens = new Map<string, { token: string; until: number }>();

  const token = async (config: SnowflakeConfig): Promise<string> => {
    const account = jwtAccount(config.account);
    const id = `${account}\n${config.user}\n${config.key}`;
    const cached = tokens.get(id);
    if (cached && cached.until > nowSeconds() + 60) return cached.token;
    const fingerprint = await publicKeyFingerprint(config.key!);
    const iat = nowSeconds();
    const jwt = await signJwt({ iss: `${account}.${config.user}.${fingerprint}`, sub: `${account}.${config.user}`, iat, exp: iat + LIFETIME }, config.key!);
    tokens.set(id, { token: jwt, until: iat + LIFETIME });
    return jwt;
  };

  const call = async (ctx: ConnectorContext, config: SnowflakeConfig, url: string, init: RequestInit): Promise<{ status: number; body: StatementResponse | undefined; text: string }> => {
    const headers = { Authorization: `Bearer ${await token(config)}`, 'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT', 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'puddle-connect' };
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, headers, ...(ctx.signal ? { signal: ctx.signal } : {}) });
    } catch (e) {
      throw fetchProblem(e, hostOf(config.url), ctx.signal);
    }
    const text = await res.text();
    let body: StatementResponse | undefined;
    try {
      body = text.trim() ? (JSON.parse(text) as StatementResponse) : undefined;
    } catch {
      body = undefined;
    }
    return { status: res.status, body, text };
  };

  const pause = (ctx: ConnectorContext, ms: number) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ctx.signal?.removeEventListener('abort', stop);
        resolve();
      }, ms);
      const stop = () => {
        clearTimeout(timer);
        reject(new ConnectorError('The read was cancelled.'));
      };
      ctx.signal?.addEventListener('abort', stop, { once: true });
    });

  /** Runs a statement, waits for it, and gathers every partition. */
  const statement = async (ctx: ConnectorContext, config: SnowflakeConfig, sql: string): Promise<SnowflakeResult> => {
    const body = { statement: sql, timeout: 60, ...(config.database ? { database: config.database } : {}), ...(config.schema ? { schema: config.schema } : {}), ...(config.warehouse ? { warehouse: config.warehouse } : {}), ...(config.role ? { role: config.role } : {}) };
    let r = await call(ctx, config, `${config.url}/api/v2/statements`, { method: 'POST', body: JSON.stringify(body) });
    let handle = r.body?.statementHandle;
    let polls = 0;
    while (r.status === 202 && handle) {
      if (ctx.signal?.aborted) {
        await fetchImpl(`${config.url}/api/v2/statements/${encodeURIComponent(handle)}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${await token(config)}`, 'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT' } }).catch(() => undefined);
        throw new ConnectorError('The read was cancelled.');
      }
      if (polls++) await pause(ctx, Math.min(1000 * polls, 5000));
      r = await call(ctx, config, `${config.url}/api/v2/statements/${encodeURIComponent(handle)}`, { method: 'GET' });
      handle = r.body?.statementHandle ?? handle;
    }
    if (r.status !== 200 || !r.body?.resultSetMetaData) throw snowflakeProblem(r.status, r.body, r.text, config);
    const meta = r.body.resultSetMetaData;
    const rows = [...(r.body.data ?? [])];
    for (let i = 1; i < (meta.partitionInfo?.length ?? 1); i++) {
      if (ctx.signal?.aborted) throw new ConnectorError('The read was cancelled.');
      const part = await call(ctx, config, `${config.url}/api/v2/statements/${encodeURIComponent(handle!)}?partition=${i}`, { method: 'GET' });
      if (part.status !== 200 || !part.body) throw snowflakeProblem(part.status, part.body, part.text, config);
      rows.push(...(part.body.data ?? []));
    }
    return { fields: meta.rowType, rows };
  };
  const maybe = async (ctx: ConnectorContext, config: SnowflakeConfig, sql: string): Promise<Row[]> => {
    try {
      return objects(await statement(ctx, config, sql));
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      return [];
    }
  };
  const rowsOf = async (ctx: ConnectorContext, config: SnowflakeConfig, detail: boolean): Promise<SchemaRows> => {
    const tables = objects(await statement(ctx, config, tablesSql(config))) as TableRow[];
    const columns = objects(await statement(ctx, config, columnsSql(config))) as ColumnRow[];
    if (!detail) return { tables, columns };
    return { tables, columns, views: await maybe(ctx, config, viewsSql(config)), primary: await maybe(ctx, config, showKeysSql(config, 'PRIMARY')), unique: await maybe(ctx, config, showKeysSql(config, 'UNIQUE')), imported: await maybe(ctx, config, showKeysSql(config, 'IMPORTED')) };
  };

  return {
    id: 'snowflake',
    runsIn: ['local', 'pi'],
    test: async (ctx): Promise<TestOutcome> => {
      const config = snowflakeConfigFor(ctx);
      const version = str(objects(await statement(ctx, config, VERSION_SQL))[0]?.VERSION);
      const n = config.database ? Number(objects(await statement(ctx, config, countSql(config)))[0]?.N ?? 0) : undefined;
      return { ok: true, server: n === undefined ? `Snowflake ${version}` : `Snowflake ${version}, ${n} ${n === 1 ? 'table' : 'tables'}` };
    },
    catalog: async (ctx) => {
      const config = snowflakeConfigFor(ctx);
      return catalogFromRows(config, await rowsOf(ctx, config, false));
    },
    document: async (ctx) => {
      const config = snowflakeConfigFor(ctx);
      return detailFromRows(config, await rowsOf(ctx, config, true));
    },
    read: async (ctx, req): Promise<ReadResult> => {
      if (!req.table && !req.query) throw new ConnectorError('Choose a table or write a query.');
      const config = snowflakeConfigFor(ctx);
      const r = await statement(ctx, config, readSql(config, req));
      const { columns, sqlTypes } = sheetFromResult(r);
      return { ipc: sheetToIPC(columns), columns: columns.map((c, i) => ({ name: c.name, sqlType: sqlTypes[i]! })), rows: r.rows.length };
    },
  };
}

export default snowflakeConnector();
