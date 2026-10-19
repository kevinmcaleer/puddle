// Building the project's schema in DuckDB: every table of its DBML with its keys, constraints, indexes and records,
// rebuilt whenever the DBML changes, so Schema table nodes read real tables. Takes any database with a query method,
// so the browser's engine and the runner (puddle-run) build it the same way.
import { dropDuckdbSchema, projectSchema, schemaDdl, schemaDdlKey } from '../compiler';
import type { Project } from '../model';

export interface Database {
  query(sql: string): Promise<unknown>;
}

/** How one table was built: ready, or why not, with anything DuckDB couldn't be given as written. */
export interface TableBuild {
  state: 'ok' | 'failed';
  message?: string;
  notes: string[];
}

export interface SchemaBuild {
  /** schemaDdlKey of the DBML built. */
  key: string;
  /** By `schema.table`. */
  tables: Record<string, TableBuild>;
}

export const buildId = (schema: string, table: string) => `${schema}.${table}`;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Drop the schemas built before (`previous`, by DBML schema name) and build the project's DBML afresh. A table DuckDB
 * refuses with its expression defaults or checks is built again without them; records that break a constraint fail
 * their table. Never throws: what went wrong is in each table's build.
 */
export async function buildSchema(db: Database, project: Project, previous: Iterable<string> = []): Promise<SchemaBuild & { schemas: string[] }> {
  const schema = projectSchema(project.schema.dbml);
  const ddl = schemaDdl(schema);
  const key = schemaDdlKey(project.schema.dbml);
  const schemas = [...new Set([...schema.tables.map((t) => t.schema), ...schema.enums.map((e) => e.schema)])];
  const tables: Record<string, TableBuild> = {};
  for (const t of ddl.tables) tables[buildId(t.schema, t.table)] = { state: 'ok', notes: ddl.warnings.filter((w) => w.element === t.name).map((w) => w.message) };

  for (const s of new Set([...previous, ...schemas])) await db.query(dropDuckdbSchema(s)).catch(() => undefined);
  try {
    for (const statement of ddl.setup) await db.query(statement);
  } catch (e) {
    for (const t of Object.values(tables)) Object.assign(t, { state: 'failed', message: `The schema can’t be created in DuckDB: ${message(e)}` });
    return { key, tables, schemas };
  }
  for (const t of ddl.tables) {
    const build = tables[buildId(t.schema, t.table)]!;
    try {
      for (const statement of t.sequences) await db.query(statement);
      try {
        await db.query(t.create);
      } catch (e) {
        if (!t.plain) throw e;
        await db.query(t.plain);
        build.notes.push(`${t.name} is created without its expression defaults and checks, which DuckDB refused: ${message(e)}`);
      }
    } catch (e) {
      Object.assign(build, { state: 'failed', message: `DuckDB can’t create ${t.name}: ${message(e)}` });
      continue;
    }
    for (const statement of t.indexes) await db.query(statement).catch((e: unknown) => build.notes.push(`An index on ${t.name} isn’t created: ${message(e)}`));
  }
  for (const t of ddl.tables) {
    const build = tables[buildId(t.schema, t.table)]!;
    if (!t.insert || build.state !== 'ok') continue;
    await db.query(t.insert).catch((e: unknown) => Object.assign(build, { state: 'failed', message: `The records of ${t.name} can’t be added: ${message(e)}` }));
  }
  return { key, tables, schemas };
}
