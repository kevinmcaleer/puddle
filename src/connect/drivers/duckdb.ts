// DuckDB database files, attached read-only to the engine itself: the catalogue comes from duckdb_tables() and
// duckdb_columns(), and a read is a relation over the attached database, which the load selects from directly.
import type { Catalog, CatalogTable } from '../../model';
import { ConnectorError, type Connector, type ConnectorContext, type EngineLike } from '../types';

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;
const str = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** The name a connection's file is registered under, and the database it is attached as. */
export const attachedName = (connectionId: string) => `conn_${connectionId.replace(/[^A-Za-z0-9_]/g, '_')}`;

const attached = new WeakMap<EngineLike, Map<string, Blob>>();

/** Attach the connection's file, once per file, read-only. */
async function attach(ctx: ConnectorContext): Promise<string> {
  if (!ctx.file) throw new ConnectorError('Choose the database file first.');
  if (!ctx.engine) throw new ConnectorError('DuckDB is still starting. Try again in a moment.');
  const name = attachedName(ctx.connection.id);
  const have = attached.get(ctx.engine) ?? new Map<string, Blob>();
  attached.set(ctx.engine, have);
  if (have.get(name) === ctx.file) return name;
  if (have.has(name)) {
    await ctx.engine.query(`DETACH ${ident(name)}`).catch(() => undefined);
    await ctx.engine.dropFile(`${name}.duckdb`).catch(() => undefined);
  }
  const file = ctx.file instanceof File ? ctx.file : new File([ctx.file], `${name}.duckdb`);
  await ctx.engine.registerFile(`${name}.duckdb`, file);
  try {
    await ctx.engine.query(`ATTACH ${str(`${name}.duckdb`)} AS ${ident(name)} (READ_ONLY)`);
  } catch (e) {
    throw new ConnectorError(`This file can’t be attached as a DuckDB database (${e instanceof Error ? e.message : String(e)}).`);
  }
  have.set(name, ctx.file);
  return name;
}

const rowsOf = (t: import('apache-arrow').Table) => Array.from({ length: t.numRows }, (_, i) => t.get(i)!.toJSON() as Record<string, unknown>);

const connector: Connector = {
  id: 'duckdb',
  runsIn: ['browser'],
  async test(ctx) {
    const db = await attach(ctx);
    const r = await ctx.engine!.query(`SELECT count(*) AS n FROM duckdb_tables() WHERE database_name = ${str(db)}`);
    const n = Number(rowsOf(r.table)[0]?.n ?? 0);
    return { ok: true, server: `DuckDB file, ${n} ${n === 1 ? 'table' : 'tables'}` };
  },
  async catalog(ctx): Promise<Catalog> {
    const db = await attach(ctx);
    const engine = ctx.engine!;
    const tables = rowsOf((await engine.query(`SELECT schema_name, table_name, estimated_size, false AS is_view FROM duckdb_tables() WHERE database_name = ${str(db)} AND NOT internal UNION ALL SELECT schema_name, view_name, NULL, true FROM duckdb_views() WHERE database_name = ${str(db)} AND NOT internal ORDER BY 4, 1, 2`)).table);
    const columns = rowsOf((await engine.query(`SELECT schema_name, table_name, column_name, data_type, is_nullable FROM duckdb_columns() WHERE database_name = ${str(db)} ORDER BY schema_name, table_name, column_index`)).table);
    return {
      tables: tables.map((t): CatalogTable => {
        const schema = String(t.schema_name);
        const name = String(t.table_name);
        return {
          schema: schema === 'main' ? undefined : schema,
          name,
          kind: t.is_view ? 'view' : 'table',
          rows: t.estimated_size == null ? undefined : Number(t.estimated_size),
          columns: columns.filter((c) => c.schema_name === schema && c.table_name === name).map((c) => ({ name: String(c.column_name), type: String(c.data_type), nullable: !!c.is_nullable })),
        };
      }),
    };
  },
  async read(ctx, req) {
    const db = await attach(ctx);
    if (req.table) {
      const relation = `${ident(db)}.${ident(req.table.schema ?? 'main')}.${ident(req.table.name)}`;
      return { relation: req.limit ? `(SELECT * FROM ${relation} LIMIT ${Math.max(1, Math.floor(req.limit))})` : relation };
    }
    const query = req.query?.trim().replace(/;\s*$/, '');
    if (!query) throw new ConnectorError('Choose a table or write a query.');
    // The query names tables as the file does ("orders", "main.orders"): the load runs it with the file as the default database.
    const relation = req.limit ? `(SELECT * FROM (${query}) LIMIT ${Math.max(1, Math.floor(req.limit))})` : `(${query})`;
    return { relation, database: db };
  },
};

export default connector;
