// Google BigQuery, read over its REST API with fetch: the same code in the page (Google's APIs answer a browser) and
// in puddle-connect. The connection signs in with a service account's JSON key: a JWT signed with the key's private
// key is exchanged for an access token scoped to reading BigQuery (bigquery.readonly), so no statement through this
// connection can write. A query goes to jobs.query; when it hasn't finished in the request's time, or has more pages,
// the rest is fetched from getQueryResults. The catalogue comes from the dataset's INFORMATION_SCHEMA views. The SQL
// here is BigQuery's GoogleSQL, not DuckDB's.
import { sheetToIPC } from '../../excel/arrow';
import type { SheetColumn } from '../../excel/types';
import type { Catalog, CatalogTable } from '../../model';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocColumn, type DocForeignKey, type DocTable, type ReadRequest, type ReadResult, type TestOutcome } from '../types';
import { bigqueryDeclaredType, bigqueryFieldType, convertBigqueryValue, plainValue, type BigqueryField, type Cell } from './bigqueryTypes';
import { baseUrl, fetchProblem, hostOf, nowSeconds, signJwt, type Fetch } from './http';

/** What a service account's JSON key file holds, as far as signing in needs. */
export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface BigqueryConfig {
  /** The API's address: Google's own unless the settings name a private endpoint. */
  endpoint: string;
  project: string;
  dataset?: string;
  key?: ServiceAccountKey;
}

/** jobs.query's and getQueryResults' answer, as far as a read needs it. */
export interface QueryResponse {
  jobComplete?: boolean;
  jobReference?: { projectId: string; jobId: string; location?: string };
  schema?: { fields: BigqueryField[] };
  rows?: { f: Cell[] }[];
  totalRows?: string;
  pageToken?: string;
  error?: { code?: number; message?: string; status?: string; errors?: { reason?: string; message?: string }[] };
  errors?: { reason?: string; message?: string }[];
}

export interface BigqueryResult {
  fields: BigqueryField[];
  rows: unknown[][];
}

export const GOOGLE_ENDPOINT = 'https://bigquery.googleapis.com';
export const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/bigquery.readonly';

/** The secret as the key it should be: the JSON key file, pasted whole. */
export function parseKey(secret: string | undefined): ServiceAccountKey {
  if (!secret?.trim()) throw new ConnectorError('Paste the service account’s JSON key to sign in.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(secret);
  } catch {
    throw new ConnectorError('The secret should be the service account’s JSON key file, pasted whole.');
  }
  const k = parsed as Partial<ServiceAccountKey>;
  if (!k || typeof k !== 'object' || typeof k.client_email !== 'string' || typeof k.private_key !== 'string') throw new ConnectorError('The key file should name a client_email and a private_key.');
  return { client_email: k.client_email, private_key: k.private_key, ...(typeof k.token_uri === 'string' ? { token_uri: k.token_uri } : {}) };
}

/** The settings as a config. The secret is the service account's key, read only when it's there (Test needs it). */
export function bigqueryConfigFor(ctx: ConnectorContext, needKey = true): BigqueryConfig {
  const s = ctx.connection.settings;
  const project = String(s.project ?? '').trim();
  if (!project) throw new ConnectorError('Give the project.');
  const dataset = String(s.dataset ?? '').trim();
  const endpoint = String(s.endpoint ?? '').trim() ? baseUrl(s.endpoint) : GOOGLE_ENDPOINT;
  const key = needKey ? parseKey(ctx.secret) : undefined;
  if (key?.token_uri && !tokenUriAllowed(key.token_uri, endpoint)) throw new ConnectorError('The key’s token_uri should be Google’s (oauth2.googleapis.com).');
  return { endpoint, project, ...(dataset ? { dataset } : {}), ...(key ? { key } : {}) };
}

/** Whether a key's token endpoint may be called: Google's own, or the API address's own host (a private endpoint, a stand-in). */
export function tokenUriAllowed(tokenUri: string, endpoint: string): boolean {
  try {
    const t = new URL(tokenUri);
    return (t.protocol === 'https:' && t.hostname === 'oauth2.googleapis.com') || t.host === new URL(endpoint).host;
  } catch {
    return false;
  }
}

/** A BigQuery or token failure in plain words, without echoing anything secret. */
export function bigqueryProblem(status: number, body: QueryResponse | { error?: string; error_description?: string } | undefined, config: BigqueryConfig): ConnectorError {
  const e = body && typeof body.error === 'object' ? body.error : undefined;
  const reason = e?.errors?.[0]?.reason ?? (body && typeof body.error === 'string' ? body.error : undefined);
  const message = (e?.message ?? (body && 'error_description' in body ? body.error_description : undefined) ?? '').split('\n')[0] ?? '';
  if (status === 401 || reason === 'invalid_grant' || reason === 'invalid_client') return new ConnectorError('Google refused the service account’s key.');
  if (status === 403 || reason === 'accessDenied') return new ConnectorError(`The service account may not read ${config.project}${message ? `: ${message}` : '.'}`);
  if (reason === 'notFound' || /^Not found: (Dataset|Project)/i.test(message)) {
    const dataset = /Dataset [^:]+:(\S+)/.exec(message)?.[1] ?? config.dataset;
    return new ConnectorError(dataset ? `There is no dataset called ${dataset} in ${config.project}.` : `There is no project called ${config.project}.`);
  }
  return new ConnectorError(`BigQuery answered: ${message || `status ${status}`}`);
}

type Row = Record<string, unknown>;

const objects = (r: BigqueryResult): Row[] => r.rows.map((row) => Object.fromEntries(r.fields.map((f, i) => [f.name, row[i]])));

/** A name in backticks; a BigQuery name can't hold a backtick, so there's nothing to escape. */
const quote = (name: string) => `\`${name.replaceAll('`', '')}\``;
const qualified = (project: string, dataset: string, name: string) => `\`${[project, dataset, name].map((n) => n.replaceAll('`', '')).join('.')}\``;

/** A dataset's INFORMATION_SCHEMA view, qualified. */
const info = (config: BigqueryConfig, dataset: string, view: string) => `${quote(`${config.project}.${dataset}`)}.INFORMATION_SCHEMA.${view}`;

export const datasetsSql = (config: BigqueryConfig) => `SELECT schema_name FROM ${quote(config.project)}.INFORMATION_SCHEMA.SCHEMATA ORDER BY schema_name`;
export const countSql = (config: BigqueryConfig, dataset: string) => `SELECT COUNT(*) AS n FROM ${info(config, dataset, 'TABLES')}`;
export const tablesSql = (config: BigqueryConfig, dataset: string) => `SELECT table_name, table_type FROM ${info(config, dataset, 'TABLES')} ORDER BY table_name`;
export const columnsSql = (config: BigqueryConfig, dataset: string) => `SELECT table_name, column_name, ordinal_position, data_type, is_nullable, column_default FROM ${info(config, dataset, 'COLUMNS')} ORDER BY table_name, ordinal_position`;
export const notesSql = (config: BigqueryConfig, dataset: string) => `SELECT table_name, column_name, description FROM ${info(config, dataset, 'COLUMN_FIELD_PATHS')} WHERE description IS NOT NULL AND field_path = column_name`;
export const tableNotesSql = (config: BigqueryConfig, dataset: string) => `SELECT table_name, option_value FROM ${info(config, dataset, 'TABLE_OPTIONS')} WHERE option_name = 'description'`;
export const rowsSql = (config: BigqueryConfig, dataset: string) => `SELECT table_id, row_count FROM ${qualified(config.project, dataset, '__TABLES__')}`;
export const viewsSql = (config: BigqueryConfig, dataset: string) => `SELECT table_name, view_definition FROM ${info(config, dataset, 'VIEWS')}`;
export const keysSql = (config: BigqueryConfig, dataset: string) =>
  `SELECT tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name, kcu.ordinal_position FROM ${info(config, dataset, 'TABLE_CONSTRAINTS')} tc JOIN ${info(config, dataset, 'KEY_COLUMN_USAGE')} kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`;
export const refsSql = (config: BigqueryConfig, dataset: string) => `SELECT constraint_name, table_name, column_name FROM ${info(config, dataset, 'CONSTRAINT_COLUMN_USAGE')}`;

export interface TableRow extends Row {
  table_name: string;
  table_type: string;
}

export interface ColumnRow extends Row {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

export interface KeyRow extends Row {
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  column_name: string;
}

const isView = (t: TableRow) => /VIEW/i.test(t.table_type);

/** The rows a dataset's catalogue is built from. */
export interface DatasetRows {
  dataset: string;
  tables: TableRow[];
  columns: ColumnRow[];
  rows?: Row[];
  notes?: Row[];
  tableNotes?: Row[];
  views?: Row[];
  keys?: KeyRow[];
  refs?: Row[];
}

/** A table option's value as TABLE_OPTIONS writes it: a quoted string literal. */
export function optionText(value: unknown): string {
  const text = String(value ?? '');
  const m = /^"((?:[^"\\]|\\.)*)"$/s.exec(text);
  return m ? m[1]!.replace(/\\(.)/g, '$1') : text;
}

/** The catalogue of one or more datasets: the dataset is the table's schema when the connection names none. */
export function catalogFromRows(config: BigqueryConfig, datasets: DatasetRows[]): Catalog {
  const out: CatalogTable[] = [];
  for (const d of datasets) {
    const byTable = new Map<string, ColumnRow[]>();
    for (const c of d.columns) byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c]);
    const counts = new Map((d.rows ?? []).map((r) => [String(r.table_id), Number(r.row_count)]));
    for (const t of d.tables) {
      const rows = counts.get(t.table_name);
      out.push({
        ...(config.dataset ? {} : { schema: d.dataset }),
        name: t.table_name,
        kind: isView(t) ? 'view' : 'table',
        columns: (byTable.get(t.table_name) ?? []).map((c) => ({ name: c.column_name, type: bigqueryDeclaredType(c.data_type).sqlType, nullable: c.is_nullable === 'YES' })),
        ...(rows !== undefined && Number.isFinite(rows) && !isView(t) ? { rows } : {}),
      });
    }
  }
  return { tables: out };
}

/** The documented schema: primary and foreign keys (BigQuery keeps them unenforced, but they say what refers to what), notes, defaults, views. */
export function detailFromRows(config: BigqueryConfig, datasets: DatasetRows[]): CatalogDetail {
  const out: DocTable[] = [];
  for (const d of datasets) {
    const byTable = new Map<string, ColumnRow[]>();
    for (const c of d.columns) byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c]);
    const notes = new Map((d.notes ?? []).map((n) => [`${n.table_name}\n${n.column_name}`, String(n.description)]));
    const tableNotes = new Map((d.tableNotes ?? []).map((n) => [String(n.table_name), optionText(n.option_value)]));
    const views = new Map((d.views ?? []).map((v) => [String(v.table_name), String(v.view_definition)]));
    const keys = d.keys ?? [];
    const refs = d.refs ?? [];
    for (const t of d.tables) {
      const pk = new Set(keys.filter((k) => k.table_name === t.table_name && k.constraint_type === 'PRIMARY KEY').map((k) => k.column_name));
      const cols: DocColumn[] = (byTable.get(t.table_name) ?? []).map((c) => {
        const note = notes.get(`${t.table_name}\n${c.column_name}`);
        const dflt = c.column_default && c.column_default !== 'NULL' ? c.column_default : undefined;
        return { name: c.column_name, type: c.data_type, pk: pk.has(c.column_name), unique: false, notNull: c.is_nullable !== 'YES', increment: false, ...(dflt !== undefined ? { default: dflt } : {}), ...(note ? { note } : {}) };
      });
      const fks: DocForeignKey[] = [];
      for (const name of new Set(keys.filter((k) => k.table_name === t.table_name && k.constraint_type === 'FOREIGN KEY').map((k) => k.constraint_name))) {
        const columns = keys.filter((k) => k.table_name === t.table_name && k.constraint_name === name).map((k) => k.column_name);
        const referenced = refs.filter((r) => r.constraint_name === name);
        if (!referenced.length) continue;
        fks.push({ name, columns, ...(config.dataset ? {} : { refSchema: d.dataset }), refTable: String(referenced[0]!.table_name), refColumns: referenced.map((r) => String(r.column_name)) });
      }
      const note = tableNotes.get(t.table_name);
      const sql = views.get(t.table_name);
      out.push({ ...(config.dataset ? {} : { schema: d.dataset }), name: t.table_name, kind: isView(t) ? 'view' : 'table', ...(note ? { note } : {}), columns: cols, indexes: [], foreignKeys: fks, ...(isView(t) && sql ? { sql } : {}) });
    }
  }
  return { tables: out, enums: [] };
}

/** A result as the sheet the loader takes: columns typed from the schema, values unwrapped and converted. */
export function sheetFromResult(r: BigqueryResult): { columns: SheetColumn[]; sqlTypes: string[] } {
  const types = r.fields.map(bigqueryFieldType);
  const columns: SheetColumn[] = r.fields.map((f, i) => ({ name: f.name, type: types[i]!.type, values: r.rows.map((row) => convertBigqueryValue(row[i], f)) }));
  return { columns, sqlTypes: types.map((t) => t.sqlType) };
}

/** The SQL a read runs: a table whole (in its dataset, or the connection's), or the query as a subquery, with the limit outside. */
export function readSql(config: BigqueryConfig, req: ReadRequest): string {
  let inner: string;
  if (req.table) {
    const dataset = req.table.schema ?? config.dataset;
    if (!dataset) throw new ConnectorError('Give the dataset to read.');
    inner = `SELECT * FROM ${qualified(config.project, dataset, req.table.name)}`;
  } else inner = `SELECT * FROM (${(req.query ?? '').trim().replace(/;\s*$/, '')}) AS puddle_query`;
  return req.limit ? `${inner} LIMIT ${Math.max(1, Math.floor(req.limit))}` : inner;
}

export function bigqueryConnector(fetchImpl: Fetch = fetch): Connector {
  /** Access tokens by service account, kept until shortly before they expire. */
  const tokens = new Map<string, { token: string; until: number }>();

  const call = async (ctx: ConnectorContext, url: string, init: RequestInit): Promise<{ status: number; body: unknown }> => {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, ...(ctx.signal ? { signal: ctx.signal } : {}) });
    } catch (e) {
      throw fetchProblem(e, hostOf(url), ctx.signal);
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = text.trim() ? JSON.parse(text) : undefined;
    } catch {
      throw new ConnectorError(`${hostOf(url)} didn’t answer as BigQuery does; check the address.`);
    }
    return { status: res.status, body };
  };

  const accessToken = async (ctx: ConnectorContext, config: BigqueryConfig): Promise<string> => {
    const key = config.key!;
    const cached = tokens.get(key.client_email);
    if (cached && cached.until > nowSeconds() + 60) return cached.token;
    const tokenUri = key.token_uri ?? TOKEN_URI;
    const iat = nowSeconds();
    const assertion = await signJwt({ iss: key.client_email, scope: SCOPE, aud: tokenUri, iat, exp: iat + 3600 }, key.private_key);
    const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`;
    const r = await call(ctx, tokenUri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const t = r.body as { access_token?: string; expires_in?: number; error?: string; error_description?: string } | undefined;
    if (r.status !== 200 || !t?.access_token) throw bigqueryProblem(r.status, t, config);
    tokens.set(key.client_email, { token: t.access_token, until: iat + (t.expires_in ?? 3600) });
    return t.access_token;
  };

  /** Runs a statement and gathers every page. */
  const run = async (ctx: ConnectorContext, config: BigqueryConfig, sql: string): Promise<BigqueryResult> => {
    const token = await accessToken(ctx, config);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const project = encodeURIComponent(config.project);
    const request = { query: sql, useLegacySql: false, timeoutMs: 30_000, maxResults: 10_000, ...(config.dataset ? { defaultDataset: { projectId: config.project, datasetId: config.dataset } } : {}) };
    let r = await call(ctx, `${config.endpoint}/bigquery/v2/projects/${project}/queries`, { method: 'POST', headers, body: JSON.stringify(request) });
    let page = r.body as QueryResponse | undefined;
    if (r.status !== 200 || !page || page.error) throw bigqueryProblem(r.status, page, config);
    const result: BigqueryResult = { fields: [], rows: [] };
    for (;;) {
      if (page.errors?.length) throw bigqueryProblem(r.status, { error: { errors: page.errors, message: page.errors[0]!.message } }, config);
      if (page.jobComplete && page.schema && !result.fields.length) result.fields = page.schema.fields;
      if (page.jobComplete && page.rows) for (const row of page.rows) result.rows.push(row.f.map((cell, i) => plainValue(cell.v, result.fields[i] ?? { name: '', type: 'STRING' })));
      if (page.jobComplete && !page.pageToken) return result;
      if (ctx.signal?.aborted) throw new ConnectorError('The read was cancelled.');
      const ref = page.jobReference;
      if (!ref) throw new ConnectorError('BigQuery answered without naming the job.');
      const next = new URL(`${config.endpoint}/bigquery/v2/projects/${encodeURIComponent(ref.projectId)}/queries/${encodeURIComponent(ref.jobId)}`);
      if (ref.location) next.searchParams.set('location', ref.location);
      next.searchParams.set('timeoutMs', '30000');
      next.searchParams.set('maxResults', '10000');
      if (page.jobComplete && page.pageToken) next.searchParams.set('pageToken', page.pageToken);
      r = await call(ctx, next.toString(), { method: 'GET', headers });
      page = r.body as QueryResponse | undefined;
      if (r.status !== 200 || !page || page.error) throw bigqueryProblem(r.status, page, config);
    }
  };
  const maybe = async (ctx: ConnectorContext, config: BigqueryConfig, sql: string): Promise<Row[]> => {
    try {
      return objects(await run(ctx, config, sql));
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      return [];
    }
  };
  const datasetsOf = async (ctx: ConnectorContext, config: BigqueryConfig): Promise<string[]> =>
    config.dataset ? [config.dataset] : objects(await run(ctx, config, datasetsSql(config))).map((r) => String(r.schema_name));
  const rowsOf = async (ctx: ConnectorContext, config: BigqueryConfig, detail: boolean): Promise<DatasetRows[]> => {
    const out: DatasetRows[] = [];
    for (const dataset of await datasetsOf(ctx, config)) {
      const tables = objects(await run(ctx, config, tablesSql(config, dataset))) as TableRow[];
      const columns = objects(await run(ctx, config, columnsSql(config, dataset))) as ColumnRow[];
      if (!detail) out.push({ dataset, tables, columns, rows: await maybe(ctx, config, rowsSql(config, dataset)) });
      else
        out.push({
          dataset,
          tables,
          columns,
          notes: await maybe(ctx, config, notesSql(config, dataset)),
          tableNotes: await maybe(ctx, config, tableNotesSql(config, dataset)),
          views: await maybe(ctx, config, viewsSql(config, dataset)),
          keys: (await maybe(ctx, config, keysSql(config, dataset))) as KeyRow[],
          refs: await maybe(ctx, config, refsSql(config, dataset)),
        });
    }
    return out;
  };

  return {
    id: 'bigquery',
    runsIn: ['browser', 'local', 'pi'],
    test: async (ctx): Promise<TestOutcome> => {
      const config = bigqueryConfigFor(ctx);
      if (config.dataset) {
        const n = Number(objects(await run(ctx, config, countSql(config, config.dataset)))[0]?.n ?? 0);
        return { ok: true, server: `BigQuery project ${config.project}, ${n} ${n === 1 ? 'table' : 'tables'}` };
      }
      const n = (await datasetsOf(ctx, config)).length;
      return { ok: true, server: `BigQuery project ${config.project}, ${n} ${n === 1 ? 'dataset' : 'datasets'}` };
    },
    catalog: async (ctx) => {
      const config = bigqueryConfigFor(ctx);
      return catalogFromRows(config, await rowsOf(ctx, config, false));
    },
    document: async (ctx) => {
      const config = bigqueryConfigFor(ctx);
      return detailFromRows(config, await rowsOf(ctx, config, true));
    },
    read: async (ctx, req): Promise<ReadResult> => {
      if (!req.table && !req.query) throw new ConnectorError('Choose a table or write a query.');
      const config = bigqueryConfigFor(ctx);
      const r = await run(ctx, config, readSql(config, req));
      const { columns, sqlTypes } = sheetFromResult(r);
      return { ipc: sheetToIPC(columns), columns: columns.map((c, i) => ({ name: c.name, sqlType: sqlTypes[i]! })), rows: r.rows.length };
    },
  };
}

export default bigqueryConnector();
