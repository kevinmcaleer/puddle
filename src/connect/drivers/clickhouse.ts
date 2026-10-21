// ClickHouse, read over its HTTP interface with fetch: the same code in the page (ClickHouse answers a browser's
// request with a CORS header when asked, so no service is needed) and in puddle-connect. Every query goes as a plain
// POST with the settings in the address, so a browser sends it without a preflight; the answer is JSONCompact, with
// 64-bit integers and decimals quoted so nothing is rounded. The catalogue comes from system.tables and
// system.columns for the connection's database. The SQL here is ClickHouse's own dialect, not DuckDB's.
import { sheetToIPC } from '../../excel/arrow';
import type { SheetColumn } from '../../excel/types';
import type { Catalog, CatalogTable } from '../../model';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocColumn, type DocIndex, type DocTable, type ReadRequest, type ReadResult, type TestOutcome } from '../types';
import { clickhouseType, convertClickhouseValue } from './clickhouseTypes';
import { baseUrl, fetchProblem, hostOf, type Fetch } from './http';

export interface ClickhouseConfig {
  url: string;
  database: string;
  user: string;
  password?: string;
}

/** What JSONCompact answers. */
export interface ClickhouseResult {
  meta: { name: string; type: string }[];
  data: unknown[][];
  rows: number;
}

/** The settings as a config. The secret is the password. */
export function clickhouseConfigFor(ctx: ConnectorContext): ClickhouseConfig {
  const s = ctx.connection.settings;
  const url = baseUrl(s.url);
  const database = String(s.database ?? '').trim() || 'default';
  const user = String(s.user ?? '').trim() || 'default';
  return { url, database, user, ...(ctx.secret !== undefined ? { password: ctx.secret } : {}) };
}

/** The address a query is posted to: the settings as parameters, so the request needs no headers and no preflight. */
export function queryUrl(config: ClickhouseConfig): string {
  const u = new URL(`${config.url}/`);
  u.searchParams.set('database', config.database);
  u.searchParams.set('user', config.user);
  u.searchParams.set('password', config.password ?? '');
  u.searchParams.set('default_format', 'JSONCompact');
  u.searchParams.set('output_format_json_quote_64bit_integers', '1');
  u.searchParams.set('output_format_json_quote_decimals', '1');
  u.searchParams.set('output_format_json_named_tuples_as_objects', '1');
  u.searchParams.set('add_http_cors_header', '1');
  // readonly=2 lets a query set its own settings but never write.
  u.searchParams.set('readonly', '2');
  return u.toString();
}

/** A ClickHouse failure in plain words, without echoing anything secret. */
export function clickhouseProblem(status: number, text: string, config: ClickhouseConfig): ConnectorError {
  const message = text.replace(/\s+\(version .*$/s, '').trim();
  const code = /Code: (\d+)/.exec(message)?.[1];
  if (status === 401 || status === 403 || code === '516' || /Authentication failed|AUTHENTICATION_FAILED/i.test(message)) return new ConnectorError('The database refused the user name or password.');
  if (code === '81' || /UNKNOWN_DATABASE|Database .* does not exist/i.test(message)) return new ConnectorError(`There is no database called ${config.database} at ${hostOf(config.url)}.`);
  if (code === '164' || /READONLY|Cannot execute query in readonly mode/i.test(message)) return new ConnectorError('The connection is read-only, so that statement can’t run.');
  const short = message.replace(/^Code: \d+\.\s*DB::Exception:\s*/, '').split('\n')[0] ?? message;
  return new ConnectorError(`The database answered: ${short || `status ${status}`}`);
}

type Row = Record<string, unknown>;

const objects = (r: ClickhouseResult): Row[] => r.data.map((row) => Object.fromEntries(r.meta.map((m, i) => [m.name, row[i]])));

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const qualified = (t: { schema?: string; name: string }) => (t.schema ? `${quote(t.schema)}.${quote(t.name)}` : quote(t.name));

export const VERSION_SQL = 'SELECT version() AS version';
export const COUNT_SQL = 'SELECT count() AS n FROM system.tables WHERE database = currentDatabase() AND NOT is_temporary';
export const TABLES_SQL = 'SELECT name, engine, comment, total_rows, create_table_query FROM system.tables WHERE database = currentDatabase() AND NOT is_temporary ORDER BY name';
export const COLUMNS_SQL = 'SELECT table, name, type, position, default_kind, default_expression, comment, is_in_primary_key, is_in_sorting_key FROM system.columns WHERE database = currentDatabase() ORDER BY table, position';
export const INDEXES_SQL = 'SELECT table, name, expr FROM system.data_skipping_indices WHERE database = currentDatabase() ORDER BY table, name';

export interface TableRow extends Row {
  name: string;
  engine: string;
  comment: string;
  total_rows: string | number | null;
  create_table_query: string;
}

export interface ColumnRow extends Row {
  table: string;
  name: string;
  type: string;
  default_kind: string;
  default_expression: string;
  comment: string;
  is_in_primary_key: number | boolean;
}

const VIEW_ENGINES = new Set(['View', 'MaterializedView', 'LiveView', 'WindowView']);
const isView = (t: TableRow) => VIEW_ENGINES.has(t.engine);

/** A default as DBML wants it: only an explicit DEFAULT (not MATERIALIZED or ALIAS, which aren't stored values). */
export function clickhouseDefault(kind: string, expression: string): string | undefined {
  return kind === 'DEFAULT' && expression.trim() ? expression.trim() : undefined;
}

/** The catalogue's tables and views from the system rows. */
export function catalogFromRows(tables: TableRow[], columns: ColumnRow[]): Catalog {
  const byTable = new Map<string, ColumnRow[]>();
  for (const c of columns) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c]);
  const out: CatalogTable[] = tables.map((t) => {
    const rows = t.total_rows === null || t.total_rows === undefined || isView(t) ? undefined : Number(t.total_rows);
    return {
      name: t.name,
      kind: isView(t) ? 'view' : 'table',
      columns: (byTable.get(t.name) ?? []).map((c) => ({ name: c.name, type: clickhouseType(c.type).sqlType, nullable: /^Nullable\(/.test(c.type) })),
      ...(rows !== undefined && Number.isFinite(rows) ? { rows } : {}),
    };
  });
  return { tables: out };
}

/** The documented schema from the system rows: primary keys from the columns, skipping indexes as indexes, no foreign keys. */
export function detailFromRows(tables: TableRow[], columns: ColumnRow[], indexes: Row[] = []): CatalogDetail {
  const byTable = new Map<string, ColumnRow[]>();
  for (const c of columns) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c]);
  const out: DocTable[] = tables.map((t) => {
    const cols: DocColumn[] = (byTable.get(t.name) ?? []).map((c) => {
      const d = clickhouseDefault(c.default_kind, c.default_expression);
      return { name: c.name, type: c.type, pk: c.is_in_primary_key === 1 || c.is_in_primary_key === true, unique: false, notNull: !/^Nullable\(/.test(c.type), increment: false, ...(d !== undefined ? { default: d } : {}), ...(c.comment ? { note: c.comment } : {}) };
    });
    const idx: DocIndex[] = indexes.filter((i) => i.table === t.name).map((i) => ({ name: String(i.name), columns: [String(i.expr)], unique: false }));
    return { name: t.name, kind: isView(t) ? 'view' : 'table', ...(t.comment ? { note: t.comment } : {}), columns: cols, indexes: idx, foreignKeys: [], ...(isView(t) && t.create_table_query ? { sql: t.create_table_query } : {}) };
  });
  return { tables: out, enums: [] };
}

/** A result as the sheet the loader takes: columns typed from the result's types, values converted. */
export function sheetFromResult(r: ClickhouseResult): { columns: SheetColumn[]; sqlTypes: string[] } {
  const types = r.meta.map((m) => clickhouseType(m.type));
  const columns: SheetColumn[] = r.meta.map((m, i) => ({ name: m.name, type: types[i]!.type, values: r.data.map((row) => convertClickhouseValue(row[i], types[i]!.type)) }));
  return { columns, sqlTypes: types.map((t) => t.sqlType) };
}

/** The SQL a read runs: a table whole, or the query as a subquery, with the limit on the outside. */
export function readSql(req: ReadRequest): string {
  const inner = req.table ? `SELECT * FROM ${qualified(req.table)}` : `SELECT * FROM (${(req.query ?? '').trim().replace(/;\s*$/, '')}) AS puddle_query`;
  return req.limit ? `${inner} LIMIT ${Math.max(1, Math.floor(req.limit))}` : inner;
}

export function clickhouseConnector(fetchImpl: Fetch = fetch): Connector {
  const query = async (ctx: ConnectorContext, config: ClickhouseConfig, sql: string): Promise<ClickhouseResult> => {
    let res: Response;
    try {
      res = await fetchImpl(queryUrl(config), { method: 'POST', body: sql, ...(ctx.signal ? { signal: ctx.signal } : {}) });
    } catch (e) {
      throw fetchProblem(e, hostOf(config.url), ctx.signal);
    }
    const text = await res.text();
    if (!res.ok) throw clickhouseProblem(res.status, text, config);
    if (!text.trim()) return { meta: [], data: [], rows: 0 };
    try {
      return JSON.parse(text) as ClickhouseResult;
    } catch {
      throw new ConnectorError(`${hostOf(config.url)} didn’t answer as ClickHouse does; check the address.`);
    }
  };
  const maybe = async (ctx: ConnectorContext, config: ClickhouseConfig, sql: string): Promise<Row[]> => {
    try {
      return objects(await query(ctx, config, sql));
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      return [];
    }
  };
  return {
    id: 'clickhouse',
    runsIn: ['browser', 'local', 'pi'],
    test: async (ctx): Promise<TestOutcome> => {
      const config = clickhouseConfigFor(ctx);
      const version = String(objects(await query(ctx, config, VERSION_SQL))[0]?.version ?? '');
      const n = Number(objects(await query(ctx, config, COUNT_SQL))[0]?.n ?? 0);
      return { ok: true, server: `ClickHouse ${version.split('.').slice(0, 3).join('.')}, ${n} ${n === 1 ? 'table' : 'tables'}` };
    },
    catalog: async (ctx) => {
      const config = clickhouseConfigFor(ctx);
      return catalogFromRows(objects(await query(ctx, config, TABLES_SQL)) as TableRow[], objects(await query(ctx, config, COLUMNS_SQL)) as ColumnRow[]);
    },
    document: async (ctx) => {
      const config = clickhouseConfigFor(ctx);
      return detailFromRows(objects(await query(ctx, config, TABLES_SQL)) as TableRow[], objects(await query(ctx, config, COLUMNS_SQL)) as ColumnRow[], await maybe(ctx, config, INDEXES_SQL));
    },
    read: async (ctx, req): Promise<ReadResult> => {
      if (!req.table && !req.query) throw new ConnectorError('Choose a table or write a query.');
      const config = clickhouseConfigFor(ctx);
      const r = await query(ctx, config, readSql(req));
      const { columns, sqlTypes } = sheetFromResult(r);
      return { ipc: sheetToIPC(columns), columns: columns.map((c, i) => ({ name: c.name, sqlType: sqlTypes[i]! })), rows: r.data.length };
    },
  };
}

export default clickhouseConnector();
