import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SQL_DIALECTS, detectDialect, type SqlDialect } from './dialect';

const fixture = (name: string) => readFileSync(`tests/fixtures/sql/${name}`, 'utf8');

describe('detectDialect', () => {
  it.each<[string, SqlDialect]>([
    ['postgres.sql', 'postgres'],
    ['mysql.sql', 'mysql'],
    ['sqlserver.sql', 'sqlserver'],
    ['sqlite.sql', 'sqlite'],
    ['duckdb.sql', 'duckdb'],
  ])('reads %s as %s', (name, dialect) => {
    expect(detectDialect(fixture(name))).toBe(dialect);
  });

  it('guesses from the syntax of short scripts', () => {
    expect(detectDialect('CREATE TABLE `t` (`id` int NOT NULL AUTO_INCREMENT) ENGINE=InnoDB;')).toBe('mysql');
    expect(detectDialect('CREATE TABLE [dbo].[t] ([id] [int] IDENTITY(1,1) NOT NULL)\nGO')).toBe('sqlserver');
    expect(detectDialect('CREATE TABLE t (id serial PRIMARY KEY, n text DEFAULT \'\'::text);')).toBe('postgres');
    expect(detectDialect('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT);')).toBe('sqlite');
    expect(detectDialect('CREATE TABLE t (id UBIGINT, big HUGEINT);')).toBe('duckdb');
  });

  it('prefers PostgreSQL when nothing points elsewhere', () => {
    expect(detectDialect('CREATE TABLE t (id int PRIMARY KEY);')).toBe('postgres');
    expect(detectDialect('')).toBe('postgres');
  });

  it('ignores what strings and comments say', () => {
    expect(detectDialect("-- ENGINE=InnoDB AUTO_INCREMENT\nCREATE TABLE t (note text DEFAULT 'GO [dbo].x');")).toBe('postgres');
  });

  it('names every dialect', () => {
    expect(SQL_DIALECTS.map((d) => d.label)).toEqual(['PostgreSQL', 'MySQL and MariaDB', 'SQL Server', 'SQLite', 'DuckDB']);
  });
});
