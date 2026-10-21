// LibSQL over HTTP (Turso, or a sqld server), read with fetch through Hrana's pipeline endpoint: the same code in
// the page (Turso answers a browser with CORS headers) and in puddle-connect. Each call is one pipeline: the
// statements run on one stream, a read inside a transaction that is rolled back so nothing a statement writes can
// last, and the stream is closed. The catalogue comes from sqlite_master and the PRAGMAs, as the SQLite file reader
// reads them (src/sqlite/read.ts), since a LibSQL database is a SQLite database. The SQL here is SQLite's.
import { sheetToIPC } from '../../excel/arrow';
import type { SheetColumn } from '../../excel/types';
import type { Catalog } from '../../model';
import { duckType } from '../../sqlite/read';
import type { SqliteTableDetail, SqliteTableInfo } from '../../sqlite/types';
import { statementProblem } from '../statement';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type ReadRequest, type ReadResult, type TestOutcome } from '../types';
import { catalogTable } from './sqlite';
import { base64Bytes, baseUrl, fetchProblem, hostOf, type Fetch } from './http';

export interface HranaConfig {
  /** The HTTP address: a libsql:// address is reached over https://. */
  url: string;
  token?: string;
}

/** A value as Hrana sends it. */
export type HranaValue = { type: 'null' } | { type: 'integer'; value: string } | { type: 'float'; value: number } | { type: 'text'; value: string } | { type: 'blob'; base64: string };

export interface HranaResult {
  cols: { name: string | null; decltype: string | null }[];
  rows: HranaValue[][];
  affected_row_count: number;
}

type PipelineResult = { type: 'ok'; response: { type: 'execute'; result: HranaResult } | { type: 'close' } } | { type: 'error'; error: { message: string; code?: string } };

/** The settings as a config. The secret is the token. */
export function hranaConfigFor(ctx: ConnectorContext): HranaConfig {
  const raw = String(ctx.connection.settings.url ?? '').trim();
  const url = baseUrl(raw.replace(/^(libsql|wss?):\/\//i, 'https://'));
  return { url, ...(ctx.secret ? { token: ctx.secret } : {}) };
}

/** One value as JavaScript holds it. */
export function plainValue(v: HranaValue): string | number | Uint8Array | null {
  switch (v.type) {
    case 'integer':
      return /^-?\d{1,15}$/.test(v.value) ? Number(v.value) : v.value;
    case 'float':
      return v.value;
    case 'text':
      return v.value;
    case 'blob':
      return base64Bytes(v.base64);
    default:
      return null;
  }
}

/** A failure in plain words, without the token. */
export function hranaProblem(status: number, text: string, config: HranaConfig): ConnectorError {
  let message = text.trim();
  try {
    const j = JSON.parse(text) as { error?: string | { message?: string }; message?: string };
    message = (typeof j.error === 'string' ? j.error : j.error?.message) ?? j.message ?? message;
  } catch {
    // Plain text.
  }
  if (status === 401 || status === 403) return new ConnectorError(config.token ? `${hostOf(config.url)} refused the token.` : `${hostOf(config.url)} needs a token.`);
  if (status === 404) return new ConnectorError(`Nothing at ${hostOf(config.url)} answers as a LibSQL server.`);
  return new ConnectorError(`The database answered: ${message || `status ${status}`}`);
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** The SQL a read runs: a table is SELECT * over it; a query runs as written, bounded by a LIMIT around it. */
export function readSql(req: ReadRequest): string {
  const limit = req.limit ? Math.max(1, Math.floor(req.limit)) : undefined;
  if (req.table) return `SELECT * FROM ${quote(req.table.name)}${limit ? ` LIMIT ${limit}` : ''}`;
  const query = (req.query ?? '').trim().replace(/;\s*$/, '');
  return limit ? `SELECT * FROM (${query}) LIMIT ${limit}` : query;
}

/** A column's type from its values, for a result that declares none. */
function inferType(values: (string | number | Uint8Array | null)[]): SheetColumn['type'] {
  let kind: SheetColumn['type'] | undefined;
  for (const v of values) {
    if (v === null) continue;
    const k: SheetColumn['type'] = typeof v === 'number' ? (Number.isInteger(v) ? 'BIGINT' : 'DOUBLE') : v instanceof Uint8Array ? 'BLOB' : 'VARCHAR';
    if (!kind) kind = k;
    else if (kind !== k) {
      if ((kind === 'BIGINT' && k === 'DOUBLE') || (kind === 'DOUBLE' && k === 'BIGINT')) kind = 'DOUBLE';
      else return 'VARCHAR';
    }
  }
  return kind ?? 'VARCHAR';
}

const convert = (v: string | number | Uint8Array | null, type: SheetColumn['type']): SheetColumn['values'][number] => {
  if (v === null) return null;
  switch (type) {
    case 'BIGINT':
      return typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : null;
    case 'DOUBLE':
      return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
    case 'BOOLEAN':
      return typeof v === 'number' ? v !== 0 : typeof v === 'string' ? /^(1|true|t|yes|y)$/i.test(v) : null;
    case 'BLOB':
      return v instanceof Uint8Array ? v : null;
    default:
      return v instanceof Uint8Array ? `0x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}` : String(v);
  }
};

/** A result as sheet columns: typed by the declared type where the column has one, else from its values. */
export function sheetFromResult(r: HranaResult, declared?: Map<string, string>): { columns: SheetColumn[]; sqlTypes: string[] } {
  const columns: SheetColumn[] = [];
  const sqlTypes: string[] = [];
  r.cols.forEach((c, i) => {
    const name = c.name ?? `column${i}`;
    const values = r.rows.map((row) => plainValue(row[i] ?? { type: 'null' }));
    const decl = declared?.get(name) ?? c.decltype ?? undefined;
    const t = decl ? duckType(decl) : { type: inferType(values), sqlType: inferType(values) };
    columns.push({ name, type: t.type, values: values.map((v) => convert(v, t.type)) });
    sqlTypes.push(t.sqlType);
  });
  return { columns, sqlTypes };
}

const TABLES_SQL = "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream_%' AND name NOT LIKE 'libsql_%' ORDER BY type, name";

type Rows = (string | number | Uint8Array | null)[][];

/** The tables with their declared columns and row counts, from what a runner of SQL answers. */
export async function listTables(run: (sql: string) => Promise<Rows>): Promise<SqliteTableInfo[]> {
  const out: SqliteTableInfo[] = [];
  for (const [name, type] of (await run(TABLES_SQL)) as [string, string][]) {
    const columns = (await run(`PRAGMA table_info(${quote(name)})`)).map((r) => ({ name: String(r[1]), type: String(r[2] ?? ''), notNull: r[3] === 1, pk: Number(r[5]) > 0 }));
    let rows = 0;
    try {
      rows = Number((await run(`SELECT count(*) FROM ${quote(name)}`))[0]?.[0] ?? 0);
    } catch {
      // A view over something missing can't be counted; it is listed all the same.
    }
    out.push({ name, kind: type === 'view' ? 'view' : 'table', columns, rows });
  }
  return out;
}

/** The tables in detail, from the PRAGMAs, as src/sqlite/read.ts describes a file. */
export async function describeTables(run: (sql: string) => Promise<Rows>): Promise<SqliteTableDetail[]> {
  const out: SqliteTableDetail[] = [];
  for (const [name, type, sql] of (await run(TABLES_SQL)) as [string, string, string | null][]) {
    const info = await run(`PRAGMA table_info(${quote(name)})`);
    const increment = type === 'table' && /\bAUTOINCREMENT\b/i.test(sql ?? '');
    const indexes: { name: string; unique: boolean; origin: string; columns: string[] }[] = [];
    for (const [, indexName, unique, origin] of (await run(`PRAGMA index_list(${quote(name)})`)) as [number, string, number, string][]) {
      indexes.push({ name: indexName, unique: unique === 1, origin, columns: ((await run(`PRAGMA index_info(${quote(indexName)})`)) as [number, number, string | null][]).map((r) => r[2]).filter((c): c is string => c !== null) });
    }
    const uniqueColumns = new Set(indexes.filter((i) => i.unique && i.origin === 'u' && i.columns.length === 1).map((i) => i.columns[0]!));
    const pkCount = info.filter((r) => Number(r[5]) > 0).length;
    const columns = info.map((r) => {
      const pk = Number(r[5]) > 0;
      return { name: String(r[1]), type: String(r[2] ?? ''), pk, unique: uniqueColumns.has(String(r[1])), notNull: r[3] === 1 || pk, increment: increment && pk && pkCount === 1, default: r[4] === null || r[4] === undefined ? undefined : String(r[4]) };
    });
    const fks = new Map<number, { columns: string[]; refTable: string; refColumns: string[] }>();
    for (const [id, , refTable, from, to] of (await run(`PRAGMA foreign_key_list(${quote(name)})`)) as [number, number, string, string, string | null][]) {
      const fk = fks.get(id) ?? { columns: [], refTable, refColumns: [] };
      fk.columns.push(from);
      fk.refColumns.push(to ?? '');
      fks.set(id, fk);
    }
    out.push({ name, kind: type === 'view' ? 'view' : 'table', columns, indexes: indexes.filter((i) => i.origin === 'c').map(({ name: n, columns: cols, unique }) => ({ name: n, columns: cols, unique })), foreignKeys: [...fks.values()], sql: type === 'view' ? (sql ?? undefined) : undefined });
  }
  return out;
}

export function hranaConnector(id: 'libsql' = 'libsql', fetchImpl?: Fetch): Connector {
  const f: Fetch = (input, init) => (fetchImpl ?? fetch)(input, init);

  /** The statements run as one pipeline on one stream, inside a transaction that is rolled back, and the results of the ones asked for. */
  const pipeline = async (ctx: ConnectorContext, statements: string[]): Promise<HranaResult[]> => {
    const config = hranaConfigFor(ctx);
    const requests = [...['BEGIN', ...statements, 'ROLLBACK'].map((sql) => ({ type: 'execute', stmt: { sql } })), { type: 'close' }];
    let res: Response;
    try {
      res = await f(`${config.url}/v2/pipeline`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) }, body: JSON.stringify({ requests }), signal: ctx.signal });
    } catch (e) {
      throw fetchProblem(e, hostOf(config.url), ctx.signal);
    }
    const text = await res.text();
    if (!res.ok) throw hranaProblem(res.status, text, config);
    let results: PipelineResult[];
    try {
      results = (JSON.parse(text) as { results: PipelineResult[] }).results;
    } catch {
      throw new ConnectorError(`Nothing at ${hostOf(config.url)} answers as a LibSQL server.`);
    }
    const out: HranaResult[] = [];
    results.slice(1, 1 + statements.length).forEach((r) => {
      if (r.type === 'error') throw new ConnectorError(`The database answered: ${r.error.message}`);
      if (r.response.type === 'execute') out.push(r.response.result);
    });
    return out;
  };
  const runner = (ctx: ConnectorContext) => async (sql: string): Promise<Rows> => (await pipeline(ctx, [sql]))[0]!.rows.map((row) => row.map(plainValue));

  const serverName = async (ctx: ConnectorContext): Promise<string> => {
    const config = hranaConfigFor(ctx);
    try {
      const res = await f(`${config.url}/version`, { headers: config.token ? { Authorization: `Bearer ${config.token}` } : {}, signal: ctx.signal });
      const v = (await res.text()).trim();
      if (res.ok && /^sqld \S+$/.test(v)) return v;
    } catch {
      // Turso's gateway has no /version.
    }
    return 'LibSQL';
  };

  return {
    id,
    runsIn: ['browser', 'local', 'pi'],
    async test(ctx): Promise<TestOutcome> {
      try {
        const [server, tables] = await Promise.all([serverName(ctx), listTables(runner(ctx))]);
        return { ok: true, server: `${server}, ${tables.length} ${tables.length === 1 ? 'table' : 'tables'}` };
      } catch (e) {
        if (e instanceof ConnectorError) return { ok: false, reason: e.message };
        throw e;
      }
    },
    async catalog(ctx): Promise<Catalog> {
      return { tables: (await listTables(runner(ctx))).map(catalogTable) };
    },
    async document(ctx): Promise<CatalogDetail> {
      const tables = await describeTables(runner(ctx));
      return { tables: tables.map((t) => ({ name: t.name, kind: t.kind, columns: t.columns, indexes: t.indexes, foreignKeys: t.foreignKeys, ...(t.sql ? { sql: t.sql } : {}) })), enums: [] };
    },
    async read(ctx, req): Promise<ReadResult> {
      if (!req.table && !req.query) throw new ConnectorError('Choose a table or write a query.');
      if (req.query) {
        const problem = statementProblem(req.query);
        if (problem) throw new ConnectorError(problem);
      }
      const run = runner(ctx);
      const declared = req.table ? new Map((await run(`PRAGMA table_info(${quote(req.table.name)})`)).map((r) => [String(r[1]), String(r[2] ?? '')])) : undefined;
      const [r] = await pipeline(ctx, [readSql(req)]);
      const { columns, sqlTypes } = sheetFromResult(r!, declared);
      return { ipc: sheetToIPC(columns), columns: columns.map((c, i) => ({ name: c.name, sqlType: sqlTypes[i]! })), rows: r!.rows.length };
    },
  };
}
