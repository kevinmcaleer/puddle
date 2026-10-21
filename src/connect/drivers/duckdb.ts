// DuckDB database files, attached read-only to the engine itself: the catalogue comes from duckdb_tables() and
// duckdb_columns(), and a read is a relation over the attached database, which the load selects from directly.
import type { Catalog, CatalogTable } from '../../model';
import { ConnectorError, type CatalogDetail, type Connector, type ConnectorContext, type DocForeignKey, type DocTable, type EngineLike } from '../types';

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
  async document(ctx): Promise<CatalogDetail> {
    const db = await attach(ctx);
    const engine = ctx.engine!;
    const q = async (sql: string) => rowsOf((await engine.query(sql)).table);
    const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v && typeof v === 'object' && 'toArray' in v ? (v as { toArray(): unknown[] }).toArray().map(String) : []);
    // duckdb_indexes() writes its columns as text: `[customer_id, "order date"]`.
    const expressions = (v: unknown): string[] =>
      String(v ?? '')
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((e) => e.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
    // A boolean default comes back as a cast: written as the value.
    const plainDefault = (d: string) => (/^CAST\('t' AS BOOLEAN\)$/i.test(d) ? 'true' : /^CAST\('f' AS BOOLEAN\)$/i.test(d) ? 'false' : d);
    const where = `database_name = ${str(db)} AND NOT internal`;
    const tables = await q(`SELECT schema_name, table_name, comment, false AS is_view, NULL AS sql FROM duckdb_tables() WHERE ${where} UNION ALL SELECT schema_name, view_name, comment, true, sql FROM duckdb_views() WHERE ${where} ORDER BY 4, 1, 2`);
    const columns = await q(`SELECT schema_name, table_name, column_name, data_type, is_nullable, column_default, comment FROM duckdb_columns() WHERE ${where} ORDER BY schema_name, table_name, column_index`);
    const constraints = await q(`SELECT schema_name, table_name, constraint_type, constraint_column_names, referenced_table, referenced_column_names FROM duckdb_constraints() WHERE database_name = ${str(db)} ORDER BY schema_name, table_name, constraint_index`);
    const indexes = await q(`SELECT schema_name, table_name, index_name, is_unique, expressions FROM duckdb_indexes() WHERE database_name = ${str(db)} ORDER BY schema_name, table_name, index_name`);
    const enums = await q(`SELECT schema_name, type_name, labels FROM duckdb_types() WHERE ${where} AND logical_type = 'ENUM' ORDER BY schema_name, type_name`);
    const schemaOf = (s: unknown) => (String(s) === 'main' ? undefined : String(s));
    const of = (r: Record<string, unknown>, s: unknown, t: unknown) => r.schema_name === s && r.table_name === t;
    return {
      tables: tables.map((t): DocTable => {
        const cs = constraints.filter((c) => of(c, t.schema_name, t.table_name));
        const pk = new Set(cs.filter((c) => c.constraint_type === 'PRIMARY KEY').flatMap((c) => list(c.constraint_column_names)));
        const unique = new Set(cs.filter((c) => c.constraint_type === 'UNIQUE').map((c) => list(c.constraint_column_names)).filter((cols) => cols.length === 1).map((cols) => cols[0]!));
        const notNull = new Set(cs.filter((c) => c.constraint_type === 'NOT NULL').flatMap((c) => list(c.constraint_column_names)));
        return {
          schema: schemaOf(t.schema_name),
          name: String(t.table_name),
          kind: t.is_view ? 'view' : 'table',
          ...(t.comment ? { note: String(t.comment) } : {}),
          columns: columns
            .filter((c) => of(c, t.schema_name, t.table_name))
            .map((c) => {
              const name = String(c.column_name);
              const def = c.column_default == null ? undefined : plainDefault(String(c.column_default));
              return { name, type: String(c.data_type), pk: pk.has(name), unique: unique.has(name), notNull: !c.is_nullable || notNull.has(name) || pk.has(name), increment: /nextval\(/i.test(def ?? ''), ...(def !== undefined ? { default: def } : {}), ...(c.comment ? { note: String(c.comment) } : {}) };
            }),
          indexes: indexes.filter((i) => of(i, t.schema_name, t.table_name)).map((i) => ({ name: String(i.index_name), columns: expressions(i.expressions), unique: !!i.is_unique })),
          foreignKeys: cs
            .filter((c) => c.constraint_type === 'FOREIGN KEY')
            .map((c): DocForeignKey => ({ columns: list(c.constraint_column_names), refTable: String(c.referenced_table), refColumns: list(c.referenced_column_names) })),
          ...(t.sql ? { sql: String(t.sql) } : {}),
        };
      }),
      enums: enums.map((e) => ({ schema: schemaOf(e.schema_name), name: String(e.type_name), values: list(e.labels) })),
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
