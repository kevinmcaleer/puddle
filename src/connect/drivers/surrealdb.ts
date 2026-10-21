// SurrealDB, read over its HTTP interface with fetch: the same code in the page (SurrealDB answers a browser with
// CORS headers, so no service is needed) and in puddle-connect. Each call posts SurrealQL to /sql with the
// namespace and database as headers and the user signed in with basic auth at the level the user was defined
// (root, namespace or database). Tables come from INFO FOR DB and their declared fields, indexes and comments from
// INFO FOR TABLE; since a table may be schemaless, the columns are also inferred from a sample of its records
// (plan section 5.1), nested objects flattened to a depth, arrays and deeper objects as JSON text. A query must
// read: SurrealDB has no read-only session, so one that writes is refused before it is sent, and the docs say to
// give the user the VIEWER role. The SurrealQL here is SurrealDB's own, not DuckDB SQL.
import { sheetToIPC } from '../../excel/arrow';
import type { Catalog, CatalogTable } from '../../model';
import { inferTable } from '../../schema/inferSchema';
import { columnKind, DEFAULT_DEPTH, documentsToSheet } from '../documents';
import { blankLiterals } from '../statement';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocColumn, type DocForeignKey, type DocIndex, type DocTable, type ReadRequest, type ReadResult, type TestOutcome } from '../types';
import { baseUrl, fetchProblem, hostOf, type Fetch } from './http';

export type SurrealLevel = 'root' | 'namespace' | 'database';

export interface SurrealConfig {
  url: string;
  namespace: string;
  database: string;
  user: string;
  password: string;
  /** Where the user was defined, which decides how the request signs in. */
  level: SurrealLevel;
  depth: number;
}

/** One statement's answer, as /sql gives a list of them. */
export interface SurrealAnswer {
  status: 'OK' | 'ERR';
  result: unknown;
}

/** The settings as a config. The secret is the password. */
export function surrealConfigFor(ctx: ConnectorContext): SurrealConfig {
  const s = ctx.connection.settings;
  const url = baseUrl(s.url);
  const namespace = String(s.namespace ?? '').trim();
  if (!namespace) throw new ConnectorError('Give the namespace.');
  const database = String(s.database ?? '').trim();
  if (!database) throw new ConnectorError('Give the database.');
  const user = String(s.user ?? '').trim();
  if (!user) throw new ConnectorError('Give the user name.');
  const level = String(s.level ?? 'root').trim().toLowerCase();
  if (level !== 'root' && level !== 'namespace' && level !== 'database') throw new ConnectorError('The user level should be root, namespace or database.');
  const depth = Number(s.depth) > 0 ? Math.floor(Number(s.depth)) : DEFAULT_DEPTH;
  return { url, namespace, database, user, password: ctx.secret ?? '', level, depth };
}

/** The headers a request signs in and names its database with. */
export function requestHeaders(config: SurrealConfig): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Basic ${btoa(`${config.user}:${config.password}`)}`,
    'surreal-ns': config.namespace,
    'surreal-db': config.database,
    ...(config.level !== 'root' ? { 'surreal-auth-ns': config.namespace } : {}),
    ...(config.level === 'database' ? { 'surreal-auth-db': config.database } : {}),
  };
}

/** A failure in plain words, without the password. */
export function surrealProblem(status: number, text: string, config: SurrealConfig): ConnectorError {
  let message = text.trim();
  try {
    const j = JSON.parse(text) as { information?: string; description?: string };
    message = (j.information ?? j.description ?? message).replace(/^There was a problem with the database: /, '');
  } catch {
    // Plain text.
  }
  if (status === 401 || status === 403) return new ConnectorError(`${hostOf(config.url)} refused the user name or password${config.level === 'root' ? '' : ` (as a ${config.level} user)`}.`);
  if (status === 404) return new ConnectorError(`Nothing at ${hostOf(config.url)} answers as a SurrealDB server.`);
  return new ConnectorError(`The database answered: ${message.split('\n')[0] || `status ${status}`}`);
}

/** A name as SurrealQL quotes it. */
export const ident = (name: string) => `\`${name.replaceAll('`', '\\`')}\``;

const WRITES = /\b(create|update|upsert|delete|insert|relate|define|remove|let|begin|commit|cancel|kill|live|use|set|rebuild|alter|option|sleep)\b/i;

/** Why a query can't run here, or undefined when it is one statement that reads (a SELECT, RETURN or INFO with nothing that writes in it). */
export function queryProblem(query: string): string | undefined {
  const blank = blankLiterals(query).trim().replace(/;\s*$/, '');
  if (!blank.trim()) return 'The query is empty.';
  if (blank.includes(';')) return 'One statement at a time: the query has a semicolon in it.';
  const word = /^[(\s]*([A-Za-z_]+)/.exec(blank)?.[1]?.toLowerCase();
  if (!word || !['select', 'return', 'info', 'show'].includes(word)) return `Only a query that reads can run here (SELECT, RETURN, INFO or SHOW), not ${word ? word.toUpperCase() : 'that'}.`;
  if (WRITES.test(blank)) return 'Only a query that reads can run here: the statement writes, creates or changes something.';
  return undefined;
}

/** The SurrealQL a read runs: a table is SELECT * over it; a query runs as written, bounded by a LIMIT around it. */
export function readSql(req: ReadRequest): string {
  const limit = req.limit ? Math.max(1, Math.floor(req.limit)) : undefined;
  if (req.table) return `SELECT * FROM ${ident(req.table.name)}${limit ? ` LIMIT ${limit}` : ''}`;
  const query = (req.query ?? '').trim().replace(/;\s*$/, '');
  return limit ? `SELECT * FROM (${query}) LIMIT ${limit}` : query;
}

/** A field as INFO FOR TABLE defines it: `DEFINE FIELD name ON t TYPE x DEFAULT d COMMENT 'c'`. */
export interface DeclaredField {
  name: string;
  type?: string;
  default?: string;
  note?: string;
}

const unquote = (s: string) => s.replace(/^'(.*)'$/s, '$1').replace(/^"(.*)"$/s, '$1');

/** The declared fields of a table from the DEFINE FIELD statements INFO FOR TABLE gives. */
export function parseFields(fields: Record<string, string>): DeclaredField[] {
  return Object.entries(fields).map(([name, def]) => {
    const type = /\bTYPE\s+(\S+(?:<[^>]*>)?)/.exec(def)?.[1];
    const dflt = /\bDEFAULT\s+(?:ALWAYS\s+)?(.+?)(?=\s+(?:PERMISSIONS|COMMENT|ASSERT|VALUE|READONLY)\b|$)/.exec(def)?.[1];
    const note = /\bCOMMENT\s+('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/.exec(def)?.[1];
    return { name, ...(type ? { type } : {}), ...(dflt ? { default: dflt.trim() } : {}), ...(note ? { note: unquote(note) } : {}) };
  });
}

/** The indexes from the DEFINE INDEX statements: `DEFINE INDEX name ON t FIELDS a, b UNIQUE`. */
export function parseIndexes(indexes: Record<string, string>): DocIndex[] {
  return Object.entries(indexes).map(([name, def]) => ({
    name,
    columns: (/\b(?:FIELDS|COLUMNS)\s+(.+?)(?=\s+(?:UNIQUE|SEARCH|MTREE|HNSW|COMMENT)\b|$)/.exec(def)?.[1] ?? '').split(',').map((c) => c.trim()).filter(Boolean),
    unique: /\bUNIQUE\b/.test(def),
  }));
}

/** The comment of a DEFINE TABLE statement. */
export const tableNote = (def: string): string | undefined => {
  const m = /\bCOMMENT\s+('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/.exec(def)?.[1];
  return m ? unquote(m) : undefined;
};

/** The DuckDB type a declared SurrealQL type loads as; undefined where the values decide. */
export function declaredDuckType(type: string | undefined): string | undefined {
  const t = (type ?? '').replace(/^option<(.*)>$/, '$1');
  if (!t || t === 'any') return undefined;
  if (t === 'int') return 'BIGINT';
  if (t === 'float' || t === 'number') return 'DOUBLE';
  if (t === 'decimal') return 'DECIMAL(38,9)';
  if (t === 'bool') return 'BOOLEAN';
  if (t === 'datetime') return 'TIMESTAMP';
  if (/^(array|object|set|geometry)/.test(t)) return 'JSON';
  return 'VARCHAR';
}

/** Whether a declared type says the field always holds a value. */
export const declaredNotNull = (type: string | undefined): boolean => !!type && type !== 'any' && !/^option</.test(type);

/** The table a declared `record<t>` type links to. */
export const recordTarget = (type: string | undefined): string | undefined => /^(?:option<)?record<([^>|]+)>/.exec(type ?? '')?.[1];

export interface SurrealTableInfo {
  name: string;
  definition: string;
  fields: DeclaredField[];
  indexes: DocIndex[];
  rows: number;
  sample: unknown[];
}

/** The catalogue: a column per field seen in the sample, typed by its declaration where one exists, else by its values. */
export function catalogFromTables(tables: SurrealTableInfo[], depth: number): Catalog {
  return {
    tables: tables.map((t): CatalogTable => {
      const declared = new Map(t.fields.map((f) => [f.name, f]));
      const { columns, sqlTypes } = documentsToSheet(t.sample, depth);
      const names = new Set(columns.map((c) => c.name));
      const seen = columns.map((c, i) => {
        const d = declared.get(c.name);
        const type = declaredDuckType(d?.type) ?? sqlTypes[i]!;
        return { name: c.name, type, nullable: !declaredNotNull(d?.type) && (d ? c.values.some((v) => v === null) : c.values.some((v) => v === null) || c.values.length === 0) };
      });
      // A declared field no sampled record holds is still a column.
      const unseen = t.fields.filter((f) => !names.has(f.name) && !f.name.includes('[') && !f.name.includes('*')).map((f) => ({ name: f.name, type: declaredDuckType(f.type) ?? 'VARCHAR', nullable: !declaredNotNull(f.type) }));
      return { name: t.name, kind: 'table', rows: t.rows, columns: [...seen, ...unseen] };
    }),
  };
}

/** The schema in detail: the inferred table from the sample, with the declared fields' types, defaults, comments and record links on top. */
export function detailFromTables(tables: SurrealTableInfo[], at: Date, depth: number): CatalogDetail {
  return {
    tables: tables.map((t): DocTable => {
      const inferred = inferTable(t.name, t.sample, at, { depth, keys: ['id'] });
      const declared = new Map(t.fields.map((f) => [f.name, f]));
      const columns: DocColumn[] = inferred.columns.map((c) => {
        const d = declared.get(c.name);
        if (!d) return c;
        return { ...c, type: d.type ?? c.type, notNull: c.notNull || declaredNotNull(d.type), ...(d.default ? { default: d.default } : {}), ...(d.note ? { note: d.note } : {}) };
      });
      const names = new Set(columns.map((c) => c.name));
      for (const f of t.fields) {
        if (names.has(f.name) || f.name.includes('[') || f.name.includes('*')) continue;
        columns.push({ name: f.name, type: f.type ?? 'any', pk: false, unique: false, notNull: declaredNotNull(f.type), increment: false, ...(f.default ? { default: f.default } : {}), ...(f.note ? { note: f.note } : {}) });
      }
      const uniques = new Set(t.indexes.filter((i) => i.unique && i.columns.length === 1).map((i) => i.columns[0]!));
      for (const c of columns) if (uniques.has(c.name)) c.unique = true;
      const foreignKeys: DocForeignKey[] = t.fields.flatMap((f) => {
        const target = recordTarget(f.type);
        return target && !f.name.includes('[') ? [{ columns: [f.name], refTable: target, refColumns: ['id'] }] : [];
      });
      const note = tableNote(t.definition);
      return { ...inferred, columns, indexes: t.indexes.filter((i) => !(i.unique && i.columns.length === 1)), foreignKeys, note: note ? `${note}. ${inferred.note}` : inferred.note };
    }),
    enums: [],
  };
}

/** Records as sheet columns, a declared datetime parsed to a timestamp and a declared decimal kept exact. */
export function sheetFromRecords(records: unknown[], fields: DeclaredField[], depth: number) {
  const { columns, sqlTypes } = documentsToSheet(records, depth);
  const declared = new Map(fields.map((f) => [f.name, f.type]));
  columns.forEach((c, i) => {
    const type = declaredDuckType(declared.get(c.name));
    if (type === 'TIMESTAMP' && columnKind(c.values) === 'VARCHAR') {
      c.type = 'TIMESTAMP';
      c.values = c.values.map((v) => (typeof v === 'string' ? (Number.isNaN(Date.parse(v)) ? null : Date.parse(v)) : null));
      sqlTypes[i] = 'TIMESTAMP';
    } else if (type === 'DECIMAL(38,9)' && c.type === 'VARCHAR') sqlTypes[i] = type;
    else if (type === 'BOOLEAN' && c.type === 'BOOLEAN') sqlTypes[i] = type;
  });
  return { columns, sqlTypes };
}

export function surrealConnector(fetchImpl?: Fetch): Connector {
  const f: Fetch = (input, init) => (fetchImpl ?? fetch)(input, init);

  /** The statements' answers, each OK or an error in plain words. */
  const sql = async (ctx: ConnectorContext, statements: string[]): Promise<unknown[]> => {
    const config = surrealConfigFor(ctx);
    let res: Response;
    try {
      res = await f(`${config.url}/sql`, { method: 'POST', headers: requestHeaders(config), body: statements.join(';\n'), signal: ctx.signal });
    } catch (e) {
      throw fetchProblem(e, hostOf(config.url), ctx.signal);
    }
    const text = await res.text();
    if (!res.ok) throw surrealProblem(res.status, text, config);
    let answers: SurrealAnswer[];
    try {
      answers = JSON.parse(text) as SurrealAnswer[];
      if (!Array.isArray(answers)) throw new Error();
    } catch {
      throw new ConnectorError(`Nothing at ${hostOf(config.url)} answers as a SurrealDB server.`);
    }
    return answers.map((a) => {
      if (a.status !== 'OK') throw new ConnectorError(`The database answered: ${String(a.result)}`);
      return a.result;
    });
  };

  const tableDefinitions = async (ctx: ConnectorContext): Promise<Record<string, string>> => {
    const [info] = (await sql(ctx, ['INFO FOR DB'])) as [{ tables?: Record<string, string> }];
    return info?.tables ?? {};
  };

  /** Every table with its declared fields and indexes, its count and a sample of its records. */
  const tables = async (ctx: ConnectorContext, sample: number): Promise<SurrealTableInfo[]> => {
    const defs = await tableDefinitions(ctx);
    const names = Object.keys(defs).sort();
    if (!names.length) return [];
    const answers = await sql(ctx, names.flatMap((n) => [`INFO FOR TABLE ${ident(n)}`, `SELECT count() FROM ${ident(n)} GROUP ALL`, `SELECT * FROM ${ident(n)} LIMIT ${sample}`]));
    return names.map((name, i) => {
      const info = answers[i * 3] as { fields?: Record<string, string>; indexes?: Record<string, string> };
      const count = answers[i * 3 + 1] as { count?: number }[];
      return { name, definition: defs[name]!, fields: parseFields(info?.fields ?? {}), indexes: parseIndexes(info?.indexes ?? {}), rows: Number(count?.[0]?.count ?? 0), sample: answers[i * 3 + 2] as unknown[] };
    });
  };

  const serverName = async (ctx: ConnectorContext): Promise<string> => {
    const config = surrealConfigFor(ctx);
    try {
      const res = await f(`${config.url}/version`, { signal: ctx.signal });
      const v = (await res.text()).trim();
      const m = /^surrealdb-(\S+)$/.exec(v);
      if (res.ok && m) return `SurrealDB ${m[1]}`;
    } catch {
      // Not every deployment serves /version.
    }
    return 'SurrealDB';
  };

  return {
    id: 'surrealdb',
    runsIn: ['browser', 'local', 'pi'],
    async test(ctx): Promise<TestOutcome> {
      try {
        const [server, defs] = await Promise.all([serverName(ctx), tableDefinitions(ctx)]);
        const n = Object.keys(defs).length;
        return { ok: true, server: `${server}, ${n} ${n === 1 ? 'table' : 'tables'}` };
      } catch (e) {
        if (e instanceof ConnectorError) return { ok: false, reason: e.message };
        throw e;
      }
    },
    async catalog(ctx): Promise<Catalog> {
      return catalogFromTables(await tables(ctx, 100), surrealConfigFor(ctx).depth);
    },
    async document(ctx): Promise<CatalogDetail> {
      return detailFromTables(await tables(ctx, 1000), new Date(), surrealConfigFor(ctx).depth);
    },
    async read(ctx, req): Promise<ReadResult> {
      if (!req.table && !req.query) throw new ConnectorError('Choose a table or write a query.');
      if (req.query) {
        const problem = queryProblem(req.query);
        if (problem) throw new ConnectorError(problem);
      }
      const config = surrealConfigFor(ctx);
      const statements = [readSql(req), ...(req.table ? [`INFO FOR TABLE ${ident(req.table.name)}`] : [])];
      const [records, info] = (await sql(ctx, statements)) as [unknown, { fields?: Record<string, string> } | undefined];
      const list = Array.isArray(records) ? records : records === null || records === undefined ? [] : [records];
      const rows = list.map((r) => (r && typeof r === 'object' && !Array.isArray(r) ? r : { value: r }));
      const { columns, sqlTypes } = sheetFromRecords(rows, parseFields(info?.fields ?? {}), config.depth);
      return { ipc: sheetToIPC(columns), columns: columns.map((c, i) => ({ name: c.name, sqlType: sqlTypes[i]! })), rows: rows.length };
    },
  };
}

export default surrealConnector();
