// Loading a connection source's rows into its table with their types, from the Arrow staging table the driver
// filled, or from a relation the engine can already select from (an attached DuckDB file).
import { ident } from './sql';

/** Make `name` the default database (an attached file's, so a query names its tables as the file does), or the in-memory one again. */
export const switchDatabase = (name = 'memory') => `USE ${ident(name)}`;

/** The types a driver may declare; anything else loads as text so a typo in a driver never fails a read. */
const LOAD_TYPE = /^(BOOLEAN|TINYINT|UTINYINT|SMALLINT|USMALLINT|INTEGER|UINTEGER|BIGINT|UBIGINT|HUGEINT|FLOAT|DOUBLE|DATE|TIME|TIMESTAMP|TIMESTAMP WITH TIME ZONE|TIMESTAMPTZ|INTERVAL|UUID|BLOB|JSON|VARCHAR|DECIMAL\(\d{1,2},\s?\d{1,2}\))$/i;

export const loadType = (sqlType: string) => (LOAD_TYPE.test(sqlType) ? sqlType.toUpperCase() : 'VARCHAR');

/**
 * A relation read in `database` (a query over an attached file, naming tables as the file does) is loaded in one
 * batch that makes that database the default, creates the table in the in-memory one by its full name, and makes
 * the in-memory database the default again: the engine runs the batch as one query, so nothing runs in between.
 */
export function compileConnectionLoad(table: string, columns: { name: string; sqlType: string }[], from: { staging: string } | { relation: string; database?: string }): string {
  const list = columns.map((c) => `CAST(${ident(c.name)} AS ${loadType(c.sqlType)}) AS ${ident(c.name)}`);
  const relation = 'staging' in from ? ident(from.staging) : from.relation;
  const database = 'database' in from ? from.database : undefined;
  const create = `CREATE OR REPLACE TABLE ${database ? 'memory.main.' : ''}${ident(table)} AS SELECT ${list.length ? list.join(', ') : '*'} FROM ${relation}`;
  return database ? `${switchDatabase(database)}; ${create}; ${switchDatabase()}` : create;
}

/** Everything in a loaded table (for describing its columns). */
export const compileTableSelect = (table: string) => `SELECT * FROM ${ident(table)}`;

/** The first rows of a relation a driver returned (a qualified table name or a subquery in brackets, SQL already). */
export const compileRelationPreview = (relation: string, limit: number) => `SELECT * FROM ${relation} LIMIT ${Math.max(1, Math.floor(limit))}`;

/** How many rows a loaded table has. */
export const compileTableCount = (table: string) => `SELECT count(*) AS n FROM ${ident(table)}`;
