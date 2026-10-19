// Export the schema as SQL for a database: the rules for each dialect, and the script.
import type { DbmlSchema } from '../../schema';
import type { DdlDialect } from '../sql';
import { DUCKDB } from './duckdbScript';
import { MYSQL } from './mysql';
import { POSTGRES } from './postgres';
import { sqlScript, type DialectRules, type ScriptOptions, type SqlScript } from './script';
import { SQLITE } from './sqlite';
import { SQLSERVER } from './sqlserver';

export const DIALECT_RULES: Record<DdlDialect, DialectRules> = { postgres: POSTGRES, mysql: MYSQL, sqlserver: SQLSERVER, sqlite: SQLITE, duckdb: DUCKDB };

/** The script that creates the schema in that database. */
export const exportSql = (schema: DbmlSchema, dialect: DdlDialect, options?: ScriptOptions): SqlScript => sqlScript(schema, DIALECT_RULES[dialect], options);

export type { ScriptOptions, SqlScript };
