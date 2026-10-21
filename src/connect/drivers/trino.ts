// Trino (and Presto), read over the REST protocol with fetch: the same code in the page (where the cluster lets the
// site in) and in puddle-connect. A statement is posted to /v1/statement and its pages followed through nextUri
// until the last; cancelling deletes the page in flight. The catalogue comes from information_schema of the
// connection's catalog. Trino has no foreign keys. The SQL here is Trino's own dialect, not DuckDB's.
import { sheetToIPC } from '../../excel/arrow';
import type { SheetColumn } from '../../excel/types';
import type { Catalog, CatalogTable } from '../../model';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocColumn, type DocTable, type ReadRequest, type ReadResult, type TestOutcome } from '../types';
import { baseUrl, fetchProblem, hostOf, type Fetch } from './http';
import { convertTrinoValue, trinoType } from './trinoTypes';

export interface TrinoConfig {
  url: string;
  catalog: string;
  schema: string;
  user: string;
  password?: string;
}

/** A page of a statement's answer, as /v1/statement and each nextUri give it. */
export interface TrinoPage {
  id?: string;
  nextUri?: string;
  columns?: { name: string; type: string }[];
  data?: unknown[][];
  error?: { message?: string; errorName?: string; errorCode?: number; errorType?: string };
  stats?: { state?: string };
}

export interface TrinoResult {
  columns: { name: string; type: string }[];
  rows: unknown[][];
}

/** The settings as a config. The secret is the password (sent only over https, as Trino requires). */
export function trinoConfigFor(ctx: ConnectorContext): TrinoConfig {
  const s = ctx.connection.settings;
  const url = baseUrl(s.url);
  const user = String(s.user ?? '').trim();
  if (!user) throw new ConnectorError('Give the user name.');
  return { url, catalog: String(s.catalog ?? '').trim(), schema: String(s.schema ?? '').trim(), user, ...(ctx.secret ? { password: ctx.secret } : {}) };
}

/** The headers a statement is sent with: the user, catalog and schema in both Trino's and Presto's spelling. */
export function statementHeaders(config: TrinoConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'text/plain' };
  for (const prefix of ['X-Trino', 'X-Presto']) {
    h[`${prefix}-User`] = config.user;
    h[`${prefix}-Source`] = 'puddle';
    if (config.catalog) h[`${prefix}-Catalog`] = config.catalog;
    if (config.schema) h[`${prefix}-Schema`] = config.schema;
  }
  if (config.password) h.Authorization = `Basic ${btoa(`${config.user}:${config.password}`)}`;
  return h;
}

/** A Trino failure in plain words, without echoing anything secret. */
export function trinoProblem(status: number, page: TrinoPage | undefined, text: string, config: TrinoConfig): ConnectorError {
  const e = page?.error;
  const name = e?.errorName ?? '';
  const message = (e?.message ?? text).trim();
  if (status === 401 || status === 403 || name === 'PERMISSION_DENIED' || /Authentication failed|Access Denied/i.test(message)) return new ConnectorError('The server refused the user name or password.');
  if (name === 'CATALOG_NOT_FOUND' || /Catalog '.*' (does not exist|not found)/i.test(message)) return new ConnectorError(`There is no catalog called ${config.catalog} at ${hostOf(config.url)}.`);
  if (name === 'SCHEMA_NOT_FOUND' || /Schema '.*' does not exist/i.test(message)) return new ConnectorError(`There is no schema called ${config.schema} in ${config.catalog}.`);
  if (status === 404 && !e) return new ConnectorError(`${hostOf(config.url)} didn’t answer as Trino does; check the address.`);
  return new ConnectorError(`The server answered: ${message.split('\n')[0] || `status ${status}`}`);
}

type Row = Record<string, unknown>;

const objects = (r: TrinoResult): Row[] => r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c.name, row[i]])));

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const qualified = (t: { schema?: string; name: string }) => (t.schema ? `${quote(t.schema)}.${quote(t.name)}` : quote(t.name));
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;

export const VERSION_SQL = 'SELECT version() AS version';
/** The catalogue SQL for the connection's catalog, and its schema when one is set. */
export const countSql = (c: TrinoConfig) => `SELECT count(*) AS n FROM ${quote(c.catalog)}.information_schema.tables WHERE table_schema <> 'information_schema'${c.schema ? ` AND table_schema = ${literal(c.schema)}` : ''}`;
export const tablesSql = (c: TrinoConfig) => `SELECT table_schema, table_name, table_type FROM ${quote(c.catalog)}.information_schema.tables WHERE table_schema <> 'information_schema'${c.schema ? ` AND table_schema = ${literal(c.schema)}` : ''} ORDER BY table_schema, table_name`;
export const columnsSql = (c: TrinoConfig) => `SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default, comment FROM ${quote(c.catalog)}.information_schema.columns WHERE table_schema <> 'information_schema'${c.schema ? ` AND table_schema = ${literal(c.schema)}` : ''} ORDER BY table_schema, table_name, ordinal_position`;
export const viewsSql = (c: TrinoConfig) => `SELECT table_schema, table_name, view_definition FROM ${quote(c.catalog)}.information_schema.views WHERE table_schema <> 'information_schema'${c.schema ? ` AND table_schema = ${literal(c.schema)}` : ''}`;

export interface TableRow extends Row {
  table_schema: string;
  table_name: string;
  table_type: string;
}

export interface ColumnRow extends Row {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  comment?: string | null;
}

const key = (schema: string, name: string) => `${schema}\u0000${name}`;

/** The tables as the catalogue names them: the schema left off when the connection names one. */
const named = (c: TrinoConfig, t: { table_schema: string; table_name: string }) => ({ name: t.table_name, ...(c.schema && t.table_schema === c.schema ? {} : { schema: t.table_schema }) });

/** The catalogue's tables and views from the information_schema rows. */
export function catalogFromRows(c: TrinoConfig, tables: TableRow[], columns: ColumnRow[]): Catalog {
  const byTable = new Map<string, ColumnRow[]>();
  for (const col of columns) byTable.set(key(col.table_schema, col.table_name), [...(byTable.get(key(col.table_schema, col.table_name)) ?? []), col]);
  const out: CatalogTable[] = tables.map((t) => ({
    ...named(c, t),
    kind: t.table_type === 'VIEW' ? 'view' : 'table',
    columns: (byTable.get(key(t.table_schema, t.table_name)) ?? []).map((col) => ({ name: col.column_name, type: trinoType(col.data_type).sqlType, nullable: col.is_nullable !== 'NO' })),
  }));
  return { tables: out };
}

/** The documented schema: columns with their declared types, defaults and comments, views with their SQL; no keys, since Trino has none. */
export function detailFromRows(c: TrinoConfig, tables: TableRow[], columns: ColumnRow[], views: Row[] = []): CatalogDetail {
  const byTable = new Map<string, ColumnRow[]>();
  for (const col of columns) byTable.set(key(col.table_schema, col.table_name), [...(byTable.get(key(col.table_schema, col.table_name)) ?? []), col]);
  const viewSql = new Map(views.map((v) => [key(String(v.table_schema), String(v.table_name)), String(v.view_definition ?? '')]));
  const out: DocTable[] = tables.map((t) => {
    const cols: DocColumn[] = (byTable.get(key(t.table_schema, t.table_name)) ?? []).map((col) => ({
      name: col.column_name,
      type: col.data_type,
      pk: false,
      unique: false,
      notNull: col.is_nullable === 'NO',
      increment: false,
      ...(col.column_default ? { default: String(col.column_default) } : {}),
      ...(col.comment ? { note: String(col.comment) } : {}),
    }));
    const sql = viewSql.get(key(t.table_schema, t.table_name));
    return { ...named(c, t), kind: t.table_type === 'VIEW' ? 'view' : 'table', columns: cols, indexes: [], foreignKeys: [], ...(sql ? { sql } : {}) };
  });
  return { tables: out, enums: [] };
}

/** A result as the sheet the loader takes: columns typed from the result's types, values converted. */
export function sheetFromResult(r: TrinoResult): { columns: SheetColumn[]; sqlTypes: string[] } {
  const types = r.columns.map((c) => trinoType(c.type));
  const columns: SheetColumn[] = r.columns.map((c, i) => ({ name: c.name, type: types[i]!.type, values: r.rows.map((row) => convertTrinoValue(row[i], types[i]!.type)) }));
  return { columns, sqlTypes: types.map((t) => t.sqlType) };
}

/** The SQL a read runs: a table whole, or the query as a subquery, with the limit on the outside. */
export function readSql(req: ReadRequest): string {
  const inner = req.table ? `SELECT * FROM ${qualified(req.table)}` : `SELECT * FROM (${(req.query ?? '').trim().replace(/;\s*$/, '')}) AS puddle_query`;
  return req.limit ? `${inner} LIMIT ${Math.max(1, Math.floor(req.limit))}` : inner;
}

export function trinoConnector(fetchImpl: Fetch = fetch): Connector {
  const page = async (ctx: ConnectorContext, config: TrinoConfig, url: string, init: RequestInit): Promise<TrinoPage> => {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, ...(ctx.signal ? { signal: ctx.signal } : {}) });
    } catch (e) {
      throw fetchProblem(e, hostOf(config.url), ctx.signal);
    }
    const text = await res.text();
    let body: TrinoPage | undefined;
    try {
      body = text.trim() ? (JSON.parse(text) as TrinoPage) : undefined;
    } catch {
      body = undefined;
    }
    if (!res.ok || !body) throw trinoProblem(res.status, body, text, config);
    if (body.error) throw trinoProblem(res.status, body, text, config);
    return body;
  };
  /** Runs a statement and gathers every page. A cancellation while a page is in flight deletes that page, which
   * tells Trino to stop the query, whether or not the fetch itself honours the signal. */
  const statement = async (ctx: ConnectorContext, config: TrinoConfig, sql: string): Promise<TrinoResult> => {
    const headers = statementHeaders(config);
    const cancelled = (url: string): Promise<never> =>
      new Promise((_, reject) => {
        const stop = () => {
          fetchImpl(url, { method: 'DELETE', headers }).catch(() => undefined);
          reject(new ConnectorError('The read was cancelled.'));
        };
        if (ctx.signal?.aborted) stop();
        else ctx.signal?.addEventListener('abort', stop, { once: true });
      });
    const fetchPage = (url: string, init: RequestInit): Promise<TrinoPage> =>
      ctx.signal ? Promise.race([page(ctx, config, url, init), cancelled(url)]) : page(ctx, config, url, init);
    let p = await fetchPage(`${config.url}/v1/statement`, { method: 'POST', headers, body: sql });
    const result: TrinoResult = { columns: [], rows: [] };
    for (;;) {
      if (p.columns && !result.columns.length) result.columns = p.columns.map((c) => ({ name: c.name, type: c.type }));
      if (p.data) result.rows.push(...p.data);
      if (!p.nextUri) return result;
      p = await fetchPage(p.nextUri, { method: 'GET', headers });
    }
  };
  const maybe = async (ctx: ConnectorContext, config: TrinoConfig, sql: string): Promise<Row[]> => {
    try {
      return objects(await statement(ctx, config, sql));
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      return [];
    }
  };
  const needCatalog = (config: TrinoConfig) => {
    if (!config.catalog) throw new ConnectorError('Give the catalog to read.');
  };
  return {
    id: 'trino',
    runsIn: ['browser', 'local', 'pi'],
    test: async (ctx): Promise<TestOutcome> => {
      const config = trinoConfigFor(ctx);
      const version = String(objects(await statement(ctx, config, VERSION_SQL))[0]?.version ?? '');
      const n = config.catalog ? Number(objects(await statement(ctx, config, countSql(config)))[0]?.n ?? 0) : undefined;
      return { ok: true, server: `Trino ${version}${n === undefined ? '' : `, ${n} ${n === 1 ? 'table' : 'tables'}`}` };
    },
    catalog: async (ctx) => {
      const config = trinoConfigFor(ctx);
      needCatalog(config);
      return catalogFromRows(config, objects(await statement(ctx, config, tablesSql(config))) as TableRow[], objects(await statement(ctx, config, columnsSql(config))) as ColumnRow[]);
    },
    document: async (ctx) => {
      const config = trinoConfigFor(ctx);
      needCatalog(config);
      return detailFromRows(config, objects(await statement(ctx, config, tablesSql(config))) as TableRow[], objects(await statement(ctx, config, columnsSql(config))) as ColumnRow[], await maybe(ctx, config, viewsSql(config)));
    },
    read: async (ctx, req): Promise<ReadResult> => {
      if (!req.table && !req.query) throw new ConnectorError('Choose a table or write a query.');
      const config = trinoConfigFor(ctx);
      const r = await statement(ctx, config, readSql(req));
      const { columns, sqlTypes } = sheetFromResult(r);
      return { ipc: sheetToIPC(columns), columns: columns.map((c, i) => ({ name: c.name, sqlType: sqlTypes[i]! })), rows: r.rows.length };
    },
  };
}

export default trinoConnector();
