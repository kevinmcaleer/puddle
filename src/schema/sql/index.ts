// Importing SQL DDL into the schema: a tolerant reader for PostgreSQL, MySQL and MariaDB, SQL Server, SQLite and DuckDB
// scripts (dumps, migrations, hand-written DDL) that builds the DBML schema model.
export { SQL_DIALECTS, SQL_DIALECT_VALUES, detectDialect, type SqlDialect } from './dialect';
export { splitStatements, type Statement, type Token } from './lexer';
export { importSql, skippedText, statementKind, type SkippedStatements, type SqlImport, type SqlWarning } from './read';
