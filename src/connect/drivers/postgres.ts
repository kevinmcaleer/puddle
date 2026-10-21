// The PostgreSQL family (PostgreSQL, Amazon Redshift, CockroachDB, GreengageDB), read over the PostgreSQL wire with
// the pg client in puddle-connect and the runner. The session is read-only where the database allows it, every value
// arrives as text and is converted by src/connect/drivers/pgTypes.ts, and the catalogue comes from information_schema
// with pg_catalog for what it lacks (comments, enums, keys, indexes), each extra on its own so a database without
// one (Redshift has no indexes) still documents the rest. The SQL here is PostgreSQL's own dialect, not DuckDB's.
import { sheetToIPC } from '../../excel/arrow';
import type { SheetColumn } from '../../excel/types';
import type { Catalog, CatalogTable } from '../../model';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocColumn, type DocForeignKey, type DocIndex, type DocTable, type ReadRequest, type ReadResult, type TestOutcome } from '../types';
import { convertValue, pgColumnType, pgDeclaredType, pgFieldType } from './pgTypes';

export type PgDriverId = 'postgres' | 'redshift' | 'cockroach' | 'greengage';

/** What the driver asks of a client: the little of pg's Client it uses, so tests can stand in for it. */
export interface PgClientLike {
  query(text: string, rowMode?: 'array'): Promise<{ rows: unknown[]; fields: { name: string; dataTypeID: number; dataTypeModifier: number }[] }>;
  end(): Promise<void>;
}

export interface PgConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl: false | { rejectUnauthorized: boolean };
}

export type PgConnect = (config: PgConfig) => Promise<PgClientLike>;

/** Connects with pg; every value is left as the text the database sent (no type parsing). */
export const pgConnect: PgConnect = async (config) => {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ ...config, connectionTimeoutMillis: 10_000, types: { getTypeParser: () => (v: string) => v } as never });
  await client.connect();
  return {
    query: async (text, rowMode) => {
      const r = rowMode ? await client.query({ text, rowMode: 'array' as const }) : await client.query(text);
      return { rows: r.rows, fields: r.fields };
    },
    end: () => client.end(),
  };
};

type Row = Record<string, string | null>;

const DEFAULT_SCHEMA = 'public';
const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_internal', 'pg_extension', 'crdb_internal'];
const userSchemas = (column: string) => `${column} NOT IN (${SYSTEM_SCHEMAS.map((s) => `'${s}'`).join(', ')}) AND ${column} NOT LIKE 'pg_toast%' AND ${column} NOT LIKE 'pg_temp%'`;

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const qualified = (t: { schema?: string; name: string }) => (t.schema ? `${quote(t.schema)}.${quote(t.name)}` : quote(t.name));
/** A schema as the catalogue names it: the default schema is left unnamed, so tables read and document as `orders`, not `public.orders`. */
const schemaOf = (s: string | null | undefined) => (s && s !== DEFAULT_SCHEMA ? s : undefined);
const key = (schema: string | null | undefined, name: string) => `${schema ?? DEFAULT_SCHEMA}.${name}`;

/** A default as written, without the casts PostgreSQL adds ('placed'::order_status is 'placed'). */
export const plainDefault = (text: string) => text.replace(/::[\w"]+(?:\.[\w"]+)?(?:\([^)]*\))?(?:\[\])?/g, '').trim();

/** pg's array text ({1,2}) as a list. */
export const pgArray = (text: string | null | undefined): string[] => (text ? text.replace(/^\{|\}$/g, '').split(',').filter(Boolean) : []);

/** The settings as a client config. The secret is the password. */
export function pgConfigFor(ctx: ConnectorContext): PgConfig {
  const s = ctx.connection.settings;
  const host = String(s.host ?? '').trim();
  const database = String(s.database ?? '').trim();
  const user = String(s.user ?? '').trim();
  if (!host) throw new ConnectorError('Give the database host.');
  if (!database) throw new ConnectorError('Give the database name.');
  if (!user) throw new ConnectorError('Give the user name.');
  const port = Number(s.port) || 5432;
  return { host, port, database, user, ...(ctx.secret !== undefined ? { password: ctx.secret } : {}), ssl: s.ssl ? { rejectUnauthorized: s.sslVerify !== false } : false };
}

/** A pg failure in plain words, without echoing anything secret. */
export function pgProblem(e: unknown, config: PgConfig): ConnectorError {
  if (e instanceof ConnectorError) return e;
  const err = e as { code?: string; message?: string };
  const message = err.message ?? String(e);
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' || err.code === 'ETIMEDOUT' || /timeout expired/i.test(message)) return new ConnectorError(`Nothing answers at ${config.host}:${config.port}.`);
  if (err.code === '28P01' || err.code === '28000') return new ConnectorError('The database refused the user name or password.');
  if (err.code === '3D000') return new ConnectorError(`There is no database called ${config.database} on ${config.host}.`);
  if (/self[- ]signed|certificate/i.test(message)) return new ConnectorError('The server’s certificate isn’t trusted. Turn off “Check the certificate” for a self-signed one.');
  if (/does not support SSL|SSL off/i.test(message)) return new ConnectorError('The server doesn’t use SSL. Turn off “Use SSL”.');
  return new ConnectorError(`The database answered: ${message}`);
}

/** The server's version line, short: "PostgreSQL 16.4" or "CockroachDB CCL v24.1.0". */
export const shortVersion = (version: string) => version.split(/ on |,|\(/)[0]!.trim().split(/\s+/).slice(0, 3).join(' ');

/** Run a query that reads a catalogue table, or nothing when the database hasn't got it. */
async function maybe<T extends Row>(client: PgClientLike, sql: string): Promise<T[]> {
  try {
    return (await client.query(sql)).rows as T[];
  } catch {
    return [];
  }
}

interface ColumnRow extends Row {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  numeric_precision: string | null;
  numeric_scale: string | null;
  character_maximum_length: string | null;
  is_nullable: string;
  column_default: string | null;
}

interface TableRow extends Row {
  table_schema: string;
  table_name: string;
  table_type: string;
}

const TABLES_SQL = `SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE ${userSchemas('table_schema')} AND table_type IN ('BASE TABLE', 'VIEW', 'FOREIGN', 'LOCAL TEMPORARY') ORDER BY table_schema, table_name`;
const COLUMNS_SQL = `SELECT table_schema, table_name, column_name, data_type, udt_name, numeric_precision::text, numeric_scale::text, character_maximum_length::text, is_nullable, column_default FROM information_schema.columns WHERE ${userSchemas('table_schema')} ORDER BY table_schema, table_name, ordinal_position`;
const ROWS_SQL = `SELECT n.nspname AS table_schema, c.relname AS table_name, c.reltuples::text AS reltuples FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p', 'f') AND ${userSchemas('n.nspname')}`;
const IDENTITY_SQL = `SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE ${userSchemas('table_schema')} AND is_identity = 'YES'`;
const COMMENTS_SQL = `SELECT n.nspname AS table_schema, c.relname AS table_name, a.attname AS column_name, d.description FROM pg_description d JOIN pg_class c ON c.oid = d.objoid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid AND d.objsubid > 0 WHERE d.classoid = 'pg_class'::regclass AND ${userSchemas('n.nspname')}`;
const ENUMS_SQL = `SELECT n.nspname AS schema, t.typname AS name, e.enumlabel AS value FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE ${userSchemas('n.nspname')} ORDER BY n.nspname, t.typname, e.enumsortorder`;
const CONSTRAINTS_SQL = `SELECT con.conname AS name, con.contype AS kind, n.nspname AS table_schema, c.relname AS table_name, con.conrelid::text AS rel, con.conkey::text AS cols, con.confrelid::text AS ref_rel, con.confkey::text AS ref_cols, fn.nspname AS ref_schema, fc.relname AS ref_table FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_class fc ON fc.oid = con.confrelid LEFT JOIN pg_namespace fn ON fn.oid = fc.relnamespace WHERE con.contype IN ('p', 'u', 'f') AND ${userSchemas('n.nspname')} ORDER BY con.conname`;
const ATTRIBUTES_SQL = `SELECT a.attrelid::text AS rel, a.attnum::text AS num, a.attname AS name FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE a.attnum > 0 AND NOT a.attisdropped AND ${userSchemas('n.nspname')}`;
const INDEXES_SQL = `SELECT schemaname AS table_schema, tablename AS table_name, indexname AS name, indexdef AS def FROM pg_indexes WHERE ${userSchemas('schemaname')} ORDER BY indexname`;
const VIEWS_SQL = `SELECT table_schema, table_name, view_definition FROM information_schema.views WHERE ${userSchemas('table_schema')}`;

/** The columns of an index from its definition: `CREATE UNIQUE INDEX x ON public.t USING btree (a, b)`, with an expression kept whole. */
export function indexColumns(def: string): string[] {
  const from = def.indexOf(' ON ');
  const open = def.indexOf('(', from < 0 ? 0 : from);
  if (open < 0) return [];
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of def.slice(open + 1)) {
    if (ch === '(') depth++;
    if (ch === ')') {
      if (depth === 0) break;
      depth--;
    }
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else current += ch;
  }
  out.push(current);
  return out.map((c) => c.trim().replace(/\s+(ASC|DESC|NULLS FIRST|NULLS LAST)\b.*$/i, '').replace(/^"(.*)"$/, '$1')).filter(Boolean);
}

/** The catalogue's tables from the rows information_schema gave. */
export function catalogFromRows(tables: TableRow[], columns: ColumnRow[], counts: Row[] = []): Catalog {
  const byTable = new Map<string, ColumnRow[]>();
  for (const c of columns) {
    const k = key(c.table_schema, c.table_name);
    byTable.set(k, [...(byTable.get(k) ?? []), c]);
  }
  const rowsOf = new Map(counts.map((r) => [key(r.table_schema, r.table_name!), Number(r.reltuples)]));
  return {
    tables: tables.map((t): CatalogTable => {
      const k = key(t.table_schema, t.table_name);
      const n = rowsOf.get(k);
      return {
        ...(schemaOf(t.table_schema) ? { schema: t.table_schema } : {}),
        name: t.table_name,
        kind: t.table_type === 'VIEW' ? 'view' : 'table',
        columns: (byTable.get(k) ?? []).map((c) => ({ name: c.column_name, type: pgColumnType(c).sqlType, nullable: c.is_nullable === 'YES' })),
        ...(n !== undefined && n > 0 ? { rows: Math.round(n) } : {}),
      };
    }),
  };
}

export interface DetailRows {
  tables: TableRow[];
  columns: ColumnRow[];
  identity?: Row[];
  comments?: Row[];
  enums?: Row[];
  constraints?: Row[];
  attributes?: Row[];
  indexes?: Row[];
  views?: Row[];
}

/** The schema in detail from the catalogue rows: a pure function of what the queries returned, so each family's rows can be checked without its server. */
export function detailFromRows(r: DetailRows): CatalogDetail {
  const columnsOf = new Map<string, ColumnRow[]>();
  for (const c of r.columns) {
    const k = key(c.table_schema, c.table_name);
    columnsOf.set(k, [...(columnsOf.get(k) ?? []), c]);
  }
  const identity = new Set((r.identity ?? []).map((x) => `${key(x.table_schema, x.table_name!)}.${x.column_name}`));
  const tableNotes = new Map<string, string>();
  const columnNotes = new Map<string, string>();
  for (const c of r.comments ?? []) {
    if (!c.description) continue;
    if (c.column_name) columnNotes.set(`${key(c.table_schema, c.table_name!)}.${c.column_name}`, c.description);
    else tableNotes.set(key(c.table_schema, c.table_name!), c.description);
  }
  const attrName = new Map((r.attributes ?? []).map((a) => [`${a.rel}.${a.num}`, a.name!]));
  const names = (rel: string | null | undefined, cols: string | null | undefined) => pgArray(cols).map((n) => attrName.get(`${rel}.${n}`) ?? '');
  const pks = new Map<string, string[]>();
  const uniques = new Map<string, string[][]>();
  const constraintNames = new Set<string>();
  const fks = new Map<string, DocForeignKey[]>();
  for (const c of r.constraints ?? []) {
    const k = key(c.table_schema, c.table_name!);
    const cols = names(c.rel, c.cols);
    if (cols.includes('')) continue;
    constraintNames.add(`${k}:${c.name}`);
    if (c.kind === 'p') pks.set(k, cols);
    else if (c.kind === 'u') uniques.set(k, [...(uniques.get(k) ?? []), cols]);
    else if (c.kind === 'f' && c.ref_table) {
      const refSchema = schemaOf(c.ref_schema);
      fks.set(k, [...(fks.get(k) ?? []), { ...(c.name ? { name: c.name } : {}), columns: cols, ...(refSchema ? { refSchema } : {}), refTable: c.ref_table, refColumns: names(c.ref_rel, c.ref_cols) }]);
    }
  }
  const indexes = new Map<string, DocIndex[]>();
  for (const i of r.indexes ?? []) {
    const k = key(i.table_schema, i.table_name!);
    // The indexes behind primary keys and unique constraints are those constraints, not indexes of their own.
    if (constraintNames.has(`${k}:${i.name}`)) continue;
    const cols = indexColumns(i.def ?? '');
    if (!cols.length) continue;
    indexes.set(k, [...(indexes.get(k) ?? []), { name: i.name!, columns: cols, unique: /^CREATE UNIQUE INDEX/i.test(i.def ?? '') }]);
  }
  const views = new Map((r.views ?? []).map((v) => [key(v.table_schema, v.table_name!), v.view_definition ?? '']));
  return {
    tables: r.tables.map((t): DocTable => {
      const k = key(t.table_schema, t.table_name);
      const pk = pks.get(k) ?? [];
      const single = new Set((uniques.get(k) ?? []).filter((u) => u.length === 1).map((u) => u[0]!));
      const multi = (uniques.get(k) ?? []).filter((u) => u.length > 1).map((u): DocIndex => ({ columns: u, unique: true }));
      const columns = (columnsOf.get(k) ?? []).map((c): DocColumn => {
        const isPk = pk.includes(c.column_name);
        const serial = /^nextval\(/i.test(c.column_default ?? '') || identity.has(`${k}.${c.column_name}`);
        const note = columnNotes.get(`${k}.${c.column_name}`);
        return {
          name: c.column_name,
          type: pgDeclaredType(c),
          pk: isPk && pk.length === 1,
          unique: single.has(c.column_name),
          notNull: c.is_nullable === 'NO',
          increment: serial,
          ...(c.column_default !== null && !serial ? { default: plainDefault(c.column_default) } : {}),
          ...(note ? { note } : {}),
        };
      });
      const note = tableNotes.get(k);
      const sql = views.get(k);
      const schema = schemaOf(t.table_schema);
      return {
        ...(schema ? { schema } : {}),
        name: t.table_name,
        kind: t.table_type === 'VIEW' ? 'view' : 'table',
        ...(note ? { note } : {}),
        columns,
        indexes: [...(pk.length > 1 ? [{ columns: pk, unique: true } satisfies DocIndex] : []), ...multi, ...(indexes.get(k) ?? [])],
        foreignKeys: fks.get(k) ?? [],
        ...(sql ? { sql: sql.trim() } : {}),
      };
    }),
    enums: Object.values(
      (r.enums ?? []).reduce<Record<string, CatalogDetail['enums'][number]>>((acc, e) => {
        const k = key(e.schema, e.name!);
        const schema = schemaOf(e.schema);
        acc[k] ??= { ...(schema ? { schema } : {}), name: e.name!, values: [] };
        acc[k].values.push(e.value!);
        return acc;
      }, {}),
    ),
  };
}

/** A read's rows as sheet columns typed from the result's fields. */
export function sheetFromResult(fields: { name: string; dataTypeID: number; dataTypeModifier: number }[], rows: (string | null)[][]): { columns: SheetColumn[]; sqlTypes: string[] } {
  const types = fields.map((f) => pgFieldType(f.dataTypeID, f.dataTypeModifier));
  return {
    columns: fields.map((f, i) => ({ name: f.name, type: types[i]!.type, values: rows.map((row) => convertValue(row[i], types[i]!.type)) })),
    sqlTypes: types.map((t) => t.sqlType),
  };
}

/** The SQL a read runs: a table whole, or the query as a subquery, with the limit on the outside. */
export function readSql(req: ReadRequest): string {
  const inner = req.table ? `SELECT * FROM ${qualified(req.table)}` : `SELECT * FROM (${(req.query ?? '').trim().replace(/;\s*$/, '')}) AS puddle_query`;
  return req.limit ? `${inner} LIMIT ${Math.max(1, Math.floor(req.limit))}` : inner;
}

const SESSION = ["SET default_transaction_read_only = on", "SET timezone = 'UTC'", "SET datestyle = 'ISO, YMD'"];

export function postgresConnector(id: PgDriverId, connect: PgConnect = pgConnect): Connector {
  /** Connect, make the session read-only and predictable, run `fn`, and close; a cancel closes the connection, which ends the query. */
  const withClient = async <T>(ctx: ConnectorContext, fn: (client: PgClientLike) => Promise<T>): Promise<T> => {
    const config = pgConfigFor(ctx);
    let client: PgClientLike;
    try {
      client = await connect(config);
    } catch (e) {
      throw pgProblem(e, config);
    }
    const stop = () => void client.end().catch(() => undefined);
    ctx.signal?.addEventListener('abort', stop);
    try {
      for (const sql of SESSION) await client.query(sql).catch(() => undefined);
      return await fn(client);
    } catch (e) {
      if (ctx.signal?.aborted) throw new ConnectorError('The read was cancelled.');
      throw pgProblem(e, config);
    } finally {
      ctx.signal?.removeEventListener('abort', stop);
      await client.end().catch(() => undefined);
    }
  };
  return {
    id,
    runsIn: ['local', 'pi'],
    test: (ctx): Promise<TestOutcome> =>
      withClient(ctx, async (client) => {
        const version = String(((await client.query('SELECT version() AS version')).rows[0] as Row | undefined)?.version ?? '');
        const tables = (await client.query(`SELECT count(*)::text AS n FROM information_schema.tables WHERE ${userSchemas('table_schema')}`)).rows[0] as Row;
        const n = Number(tables?.n ?? 0);
        return { ok: true, server: `${shortVersion(version)}, ${n} ${n === 1 ? 'table' : 'tables'}` };
      }),
    catalog: (ctx) => withClient(ctx, async (client) => catalogFromRows((await client.query(TABLES_SQL)).rows as TableRow[], (await client.query(COLUMNS_SQL)).rows as ColumnRow[], await maybe(client, ROWS_SQL))),
    document: (ctx) =>
      withClient(ctx, async (client) =>
        detailFromRows({
          tables: (await client.query(TABLES_SQL)).rows as TableRow[],
          columns: (await client.query(COLUMNS_SQL)).rows as ColumnRow[],
          identity: await maybe(client, IDENTITY_SQL),
          comments: await maybe(client, COMMENTS_SQL),
          enums: await maybe(client, ENUMS_SQL),
          constraints: await maybe(client, CONSTRAINTS_SQL),
          attributes: await maybe(client, ATTRIBUTES_SQL),
          indexes: await maybe(client, INDEXES_SQL),
          views: await maybe(client, VIEWS_SQL),
        }),
      ),
    read: (ctx, req): Promise<ReadResult> =>
      withClient(ctx, async (client) => {
        if (!req.table && !req.query) throw new ConnectorError('Choose a table or write a query.');
        const r = await client.query(readSql(req), 'array');
        const { columns, sqlTypes } = sheetFromResult(r.fields, r.rows as (string | null)[][]);
        return { ipc: sheetToIPC(columns), columns: columns.map((c, i) => ({ name: c.name, sqlType: sqlTypes[i]! })), rows: r.rows.length };
      }),
  };
}
