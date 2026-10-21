// Apache Cassandra and ScyllaDB, read with the DataStax driver (ScyllaDB speaks CQL) in puddle-connect and the
// runner. The catalogue comes from system_schema: keyspaces, tables, materialized views, columns with their kinds
// (partition key, clustering, static, regular) and the secondary indexes; the partition and clustering keys are
// the primary key. A table is read whole, by the row limit, or with the source's WHERE condition; one on a column
// that isn't a key makes the server scan the table, which it refuses unless the source turns on ALLOW FILTERING
// (plan section 5.1). A query is one CQL SELECT. The CQL here is Cassandra's own, not DuckDB SQL.
import { sheetToIPC } from '../../excel/arrow';
import type { SheetColumn } from '../../excel/types';
import type { Catalog, CatalogTable } from '../../model';
import { blankLiterals, statementProblem } from '../statement';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocColumn, type DocIndex, type DocTable, type ReadRequest, type ReadResult, type TestOutcome } from '../types';
import { convertCqlValue, cqlDeclaredType, cqlFieldType, plainCql } from './cassandraTypes';

export interface CqlColumn {
  name: string;
  type: { code: number };
}

export interface CqlResult {
  rows: Record<string, unknown>[];
  columns: CqlColumn[];
}

/** What the driver asks of a client: one statement, its rows paged up to a limit, values already plain (plainCql), so tests can stand in for it. */
export interface CqlClientLike {
  execute(cql: string, limit?: number): Promise<CqlResult>;
  end(): Promise<void>;
}

export interface CassandraConfig {
  host: string;
  port: number;
  keyspace?: string;
  datacenter: string;
  user?: string;
  password?: string;
  ssl: boolean;
  sslVerify: boolean;
}

export type CassandraConnect = (config: CassandraConfig) => Promise<CqlClientLike>;

/** Connects with the DataStax driver, paging each statement's rows. */
export const cassandraConnect: CassandraConnect = async (config) => {
  const { Client } = await import('cassandra-driver');
  const client = new Client({
    contactPoints: [`${config.host}:${config.port}`],
    localDataCenter: config.datacenter,
    ...(config.keyspace ? { keyspace: config.keyspace } : {}),
    ...(config.user ? { credentials: { username: config.user, password: config.password ?? '' } } : {}),
    ...(config.ssl ? { sslOptions: { rejectUnauthorized: config.sslVerify } } : {}),
    socketOptions: { connectTimeout: 10_000, readTimeout: 60_000 },
  });
  await client.connect();
  return {
    execute: async (cql, limit) => {
      const rows: Record<string, unknown>[] = [];
      let columns: CqlColumn[] = [];
      let pageState: string | undefined;
      do {
        const rs = await client.execute(cql, [], { prepare: false, fetchSize: Math.min(limit ?? 5000, 5000), ...(pageState ? { pageState } : {}) });
        columns = (rs.columns ?? []).map((c) => ({ name: c.name, type: { code: c.type.code } }));
        for (const row of rs.rows ?? []) rows.push(Object.fromEntries(columns.map((c) => [c.name, plainCql((row as Record<string, unknown>)[c.name])])));
        pageState = rs.pageState ?? undefined;
      } while (pageState && (!limit || rows.length < limit));
      return { rows: limit ? rows.slice(0, limit) : rows, columns };
    },
    end: () => client.shutdown(),
  };
};

type Row = Record<string, unknown>;

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

/** The settings as a client config. The secret is the password. */
export function cassandraConfigFor(ctx: ConnectorContext): CassandraConfig {
  const s = ctx.connection.settings;
  const host = String(s.host ?? '').trim();
  if (!host) throw new ConnectorError('Give the database host.');
  const keyspace = String(s.keyspace ?? '').trim();
  const user = String(s.user ?? '').trim();
  return { host, port: Number(s.port) || 9042, ...(keyspace ? { keyspace } : {}), datacenter: String(s.datacenter ?? '').trim() || 'datacenter1', ...(user ? { user } : {}), ...(ctx.secret !== undefined ? { password: ctx.secret } : {}), ssl: s.ssl === true || s.ssl === 'true', sslVerify: s.sslVerify !== false && s.sslVerify !== 'false' };
}

/** A driver failure in plain words, without echoing anything secret. */
export function cassandraProblem(e: unknown, config: CassandraConfig): ConnectorError {
  if (e instanceof ConnectorError) return e;
  const err = e as { name?: string; code?: number; message?: string; innerErrors?: Record<string, { message?: string }> };
  const inner = err.innerErrors ? Object.values(err.innerErrors).map((x) => x.message ?? '').join(' ') : '';
  const message = `${err.message ?? String(e)} ${inner}`.trim();
  if (/AuthenticationError|Authentication error|Provided username .* password are incorrect|Authentication failed/i.test(`${err.name} ${message}`)) return new ConnectorError('The database refused the user name or password.');
  if (err.name === 'NoHostAvailableError' || /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|Connection timeout|All host\(s\) tried/i.test(message)) return new ConnectorError(`Nothing answers at ${config.host}:${config.port}.`);
  if (/certificate|CERT_|self[- ]signed/i.test(message)) return new ConnectorError(`${config.host}’s certificate isn’t trusted.`);
  if (/local data ?cent(er|re)|localDataCenter/i.test(message)) return new ConnectorError(`No node is in the data centre ${config.datacenter}: ${message}`);
  if (/Unauthorized|has no .* permission/i.test(message)) return new ConnectorError(`The user may not read that: ${message}`);
  if (/ALLOW FILTERING/i.test(message)) return new ConnectorError('That condition isn’t on a key column, so the read would scan the table: turn on Allow filtering to let it.');
  if (/Keyspace .* does not exist|unconfigured table|table .* does not exist/i.test(message)) return new ConnectorError(`There is no such table: ${message}`);
  return new ConnectorError(`The database answered: ${message}`);
}

export const VERSION_CQL = 'SELECT release_version, cluster_name FROM system.local';
export const SCYLLA_VERSION_CQL = 'SELECT version FROM system.versions';
export const TABLES_CQL = 'SELECT keyspace_name, table_name, comment FROM system_schema.tables';
export const VIEWS_CQL = 'SELECT keyspace_name, view_name, base_table_name, comment FROM system_schema.views';
export const COLUMNS_CQL = 'SELECT keyspace_name, table_name, column_name, clustering_order, kind, position, type FROM system_schema.columns';
export const INDEXES_CQL = 'SELECT keyspace_name, table_name, index_name, kind, options FROM system_schema.indexes';

/** A catalogue statement for one keyspace, or every keyspace but the system ones when none is named. */
export const inKeyspace = (cql: string, keyspace?: string) => (keyspace ? `${cql} WHERE keyspace_name = ${literal(keyspace)}` : cql);

const system = (keyspace: unknown) => /^system/i.test(String(keyspace));

const KINDS: Record<string, number> = { partition_key: 0, clustering: 1, static: 2, regular: 3 };

/** The columns of a table in their declared order: partition keys, clustering keys, then the rest by name (as the server keeps them). */
export function orderedColumns(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => (KINDS[String(a.kind)] ?? 3) - (KINDS[String(b.kind)] ?? 3) || Number(a.position ?? 0) - Number(b.position ?? 0) || String(a.column_name).localeCompare(String(b.column_name)));
}

const isKey = (c: Row) => c.kind === 'partition_key' || c.kind === 'clustering';

/** An index's column: the target option, with values(), keys(), entries() or full() unwrapped. */
export const indexColumn = (options: unknown): string => {
  const target = String((options as { target?: unknown } | null)?.target ?? '');
  return /^\w+\((.*)\)$/.exec(target)?.[1] ?? target;
};

/** The catalogue: tables and materialized views with their declared columns, each in its keyspace. */
export function catalogFromRows(tables: Row[], views: Row[], columns: Row[], keyspace?: string): Catalog {
  const keep = (r: Row) => (keyspace ? r.keyspace_name === keyspace : !system(r.keyspace_name));
  const byTable = new Map<string, Row[]>();
  for (const c of columns.filter(keep)) {
    const k = `${c.keyspace_name}.${c.table_name}`;
    byTable.set(k, [...(byTable.get(k) ?? []), c]);
  }
  const cols = (ks: unknown, name: unknown) => orderedColumns(byTable.get(`${ks}.${name}`) ?? []).map((c) => ({ name: String(c.column_name), type: cqlDeclaredType(String(c.type)).sqlType, nullable: !isKey(c) }));
  const sorted = (rows: Row[], name: string) => [...rows].sort((a, b) => String(a.keyspace_name).localeCompare(String(b.keyspace_name)) || String(a[name]).localeCompare(String(b[name])));
  return {
    tables: [
      ...sorted(tables.filter(keep), 'table_name').map((t): CatalogTable => ({ schema: String(t.keyspace_name), name: String(t.table_name), kind: 'table', columns: cols(t.keyspace_name, t.table_name) })),
      ...sorted(views.filter(keep), 'view_name').map((v): CatalogTable => ({ schema: String(v.keyspace_name), name: String(v.view_name), kind: 'view', columns: cols(v.keyspace_name, v.view_name) })),
    ],
  };
}

export interface DetailRows {
  tables: Row[];
  views: Row[];
  columns: Row[];
  indexes: Row[];
}

/** The schema in detail, driver-neutral: the keys as the primary key, static and clustering columns noted, the indexes, a view's base table. */
export function detailFromRows(r: DetailRows, keyspace?: string): CatalogDetail {
  const keep = (x: Row) => (keyspace ? x.keyspace_name === keyspace : !system(x.keyspace_name));
  const columnsOf = (ks: unknown, name: unknown): DocColumn[] => {
    const rows = orderedColumns(r.columns.filter((c) => keep(c) && c.keyspace_name === ks && c.table_name === name));
    const keys = rows.filter(isKey);
    return rows.map((c) => {
      const key = isKey(c);
      const notes = [c.kind === 'partition_key' && keys.length > 1 && 'partition key', c.kind === 'clustering' && `clustering key${c.clustering_order && c.clustering_order !== 'none' ? `, ${String(c.clustering_order).toLowerCase() === 'desc' ? 'descending' : 'ascending'}` : ''}`, c.kind === 'static' && 'static'].filter(Boolean);
      return { name: String(c.column_name), type: String(c.type), pk: key, unique: key && keys.length === 1, notNull: key, increment: false, ...(notes.length ? { note: notes.join('; ') } : {}) };
    });
  };
  const indexesOf = (ks: unknown, name: unknown): DocIndex[] => r.indexes.filter((i) => keep(i) && i.keyspace_name === ks && i.table_name === name).map((i) => ({ name: String(i.index_name), columns: [indexColumn(i.options)], unique: false }));
  const sorted = (rows: Row[], name: string) => [...rows].sort((a, b) => String(a.keyspace_name).localeCompare(String(b.keyspace_name)) || String(a[name]).localeCompare(String(b[name])));
  return {
    tables: [
      ...sorted(r.tables.filter(keep), 'table_name').map((t): DocTable => ({ schema: String(t.keyspace_name), name: String(t.table_name), kind: 'table', ...(t.comment ? { note: String(t.comment) } : {}), columns: columnsOf(t.keyspace_name, t.table_name), indexes: indexesOf(t.keyspace_name, t.table_name), foreignKeys: [] })),
      ...sorted(r.views.filter(keep), 'view_name').map((v): DocTable => ({ schema: String(v.keyspace_name), name: String(v.view_name), kind: 'view', note: `A materialized view of ${String(v.base_table_name)}${v.comment ? `. ${String(v.comment)}` : ''}`, columns: columnsOf(v.keyspace_name, v.view_name), indexes: [], foreignKeys: [] })),
    ],
    enums: [],
  };
}

/** A result as sheet columns typed from the codes the protocol describes them with. */
export function sheetFromResult(r: CqlResult): { columns: SheetColumn[]; sqlTypes: string[] } {
  const types = r.columns.map(cqlFieldType);
  return {
    columns: r.columns.map((c, i) => ({ name: c.name, type: types[i]!.type, values: r.rows.map((row) => convertCqlValue(row[c.name], types[i]!.type)) })),
    sqlTypes: types.map((t) => t.sqlType),
  };
}

/**
 * The CQL a read runs: a table is SELECT * over it with the source's condition, the row limit and, when the source
 * turned it on, ALLOW FILTERING; a query runs as written, bounded by LIMIT unless it has one (CQL has no subqueries
 * to wrap it in).
 */
export function readCql(req: ReadRequest, keyspace?: string): string {
  const limit = req.limit ? Math.max(1, Math.floor(req.limit)) : undefined;
  if (req.table) {
    const ks = req.table.schema ?? keyspace;
    if (!ks) throw new ConnectorError('Give the keyspace of the table, on the connection or with the table.');
    const where = (req.filter ?? '').trim().replace(/;\s*$/, '');
    if (where && /;/.test(blankLiterals(where))) throw new ConnectorError('The condition is one expression, without a semicolon.');
    if (/allow\s+filtering/i.test(blankLiterals(where))) throw new ConnectorError('Turn on Allow filtering instead of writing it in the condition.');
    return `SELECT * FROM ${quote(ks)}.${quote(req.table.name)}${where ? ` WHERE ${where}` : ''}${limit ? ` LIMIT ${limit}` : ''}${req.allowFiltering ? ' ALLOW FILTERING' : ''}`;
  }
  const query = (req.query ?? '').trim().replace(/;\s*$/, '');
  if (!limit) return query;
  const blank = blankLiterals(query);
  if (/\blimit\s+\d+/i.test(blank)) return query;
  const m = /\s+allow\s+filtering\s*$/i.exec(blank);
  return m ? `${query.slice(0, m.index)} LIMIT ${limit}${query.slice(m.index)}` : `${query} LIMIT ${limit}`;
}

/** Run a catalogue statement, or nothing where the server has no such table (ScyllaDB and older versions differ in places). */
async function maybe(client: CqlClientLike, cql: string): Promise<Row[]> {
  try {
    return (await client.execute(cql)).rows;
  } catch (e) {
    if (/unconfigured table|does not exist|Undefined column name|Unauthorized/i.test(e instanceof Error ? e.message : String(e))) return [];
    throw e;
  }
}

export function cassandraConnector(id: 'cassandra' | 'scylla' = 'cassandra', connect: CassandraConnect = cassandraConnect): Connector {
  const label = id === 'scylla' ? 'ScyllaDB' : 'Cassandra';
  const withClient = async <T>(ctx: ConnectorContext, fn: (client: CqlClientLike, config: CassandraConfig) => Promise<T>): Promise<T> => {
    const config = cassandraConfigFor(ctx);
    let client: CqlClientLike;
    try {
      client = await connect(config);
    } catch (e) {
      throw cassandraProblem(e, config);
    }
    const stop = () => void client.end().catch(() => undefined);
    if (ctx.signal?.aborted) {
      stop();
      throw new ConnectorError('The read was cancelled.');
    }
    ctx.signal?.addEventListener('abort', stop);
    try {
      return await fn(client, config);
    } catch (e) {
      if (ctx.signal?.aborted) throw new ConnectorError('The read was cancelled.');
      throw cassandraProblem(e, config);
    } finally {
      ctx.signal?.removeEventListener('abort', stop);
      await client.end().catch(() => undefined);
    }
  };
  return {
    id,
    runsIn: ['local', 'pi'],
    test: (ctx): Promise<TestOutcome> =>
      withClient(ctx, async (client, config) => {
        const local = (await client.execute(VERSION_CQL)).rows[0] ?? {};
        const scylla = id === 'scylla' ? String((await maybe(client, SCYLLA_VERSION_CQL))[0]?.version ?? '') : '';
        const version = scylla || String(local.release_version ?? '');
        const tables = (await client.execute(inKeyspace(TABLES_CQL, config.keyspace))).rows.filter((t) => config.keyspace || !system(t.keyspace_name));
        const n = tables.length;
        return { ok: true, server: `${label}${version ? ` ${version}` : ''}, ${n} ${n === 1 ? 'table' : 'tables'}` };
      }),
    catalog: (ctx) => withClient(ctx, async (client, config) => catalogFromRows((await client.execute(inKeyspace(TABLES_CQL, config.keyspace))).rows, await maybe(client, inKeyspace(VIEWS_CQL, config.keyspace)), (await client.execute(inKeyspace(COLUMNS_CQL, config.keyspace))).rows, config.keyspace)),
    document: (ctx) =>
      withClient(ctx, async (client, config) =>
        detailFromRows(
          {
            tables: (await client.execute(inKeyspace(TABLES_CQL, config.keyspace))).rows,
            views: await maybe(client, inKeyspace(VIEWS_CQL, config.keyspace)),
            columns: (await client.execute(inKeyspace(COLUMNS_CQL, config.keyspace))).rows,
            indexes: await maybe(client, inKeyspace(INDEXES_CQL, config.keyspace)),
          },
          config.keyspace,
        ),
      ),
    read: (ctx, req): Promise<ReadResult> =>
      withClient(ctx, async (client, config) => {
        if (!req.table && !req.query) throw new ConnectorError('Choose a table or write a query.');
        if (req.query) {
          const problem = statementProblem(req.query);
          if (problem) throw new ConnectorError(problem);
        }
        const limit = req.limit ? Math.max(1, Math.floor(req.limit)) : undefined;
        const r = await client.execute(readCql(req, config.keyspace), limit);
        const { columns, sqlTypes } = sheetFromResult(r);
        return { ipc: sheetToIPC(columns), columns: columns.map((c, i) => ({ name: c.name, sqlType: sqlTypes[i]! })), rows: r.rows.length };
      }),
  };
}

export default cassandraConnector();
