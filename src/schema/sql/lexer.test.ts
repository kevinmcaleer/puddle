import { describe, expect, it } from 'vitest';
import { splitStatements } from './lexer';
import type { SqlDialect } from './dialect';

/** Each statement's text, from its first token to its last. */
const split = (sql: string, dialect: SqlDialect = 'postgres') => splitStatements(sql, dialect).map((s) => sql.slice(s.tokens[0]!.start, s.tokens[s.tokens.length - 1]!.end));

describe('splitStatements', () => {
  it('splits at semicolons and drops empty statements', () => {
    expect(split('CREATE TABLE a (x int);;\n\nSELECT 1;\nSELECT 2')).toEqual(['CREATE TABLE a (x int)', 'SELECT 1', 'SELECT 2']);
  });

  it('keeps semicolons inside strings and quoted identifiers', () => {
    expect(split(`INSERT INTO t VALUES ('a;b', 'it''s; fine');\nSELECT "odd;name" FROM t;`)).toEqual([`INSERT INTO t VALUES ('a;b', 'it''s; fine')`, 'SELECT "odd;name" FROM t']);
    expect(split("INSERT INTO `t;x` VALUES ('O\\'Hara; Ltd');SELECT 1", 'mysql')).toEqual(["INSERT INTO `t;x` VALUES ('O\\'Hara; Ltd')", 'SELECT 1']);
    expect(split('SELECT [a;b] FROM t; SELECT 2', 'sqlserver')).toEqual(['SELECT [a;b] FROM t', 'SELECT 2']);
  });

  it('reads string values without quotes and escapes', () => {
    const [st] = splitStatements(`SELECT 'it''s', N'naïve', E'a\\'b'`, 'postgres');
    expect(st!.tokens.filter((t) => t.kind === 'string').map((t) => t.value)).toEqual(["it's", 'naïve', "a'b"]);
  });

  it('ignores semicolons in comments', () => {
    expect(split('-- one; two\nSELECT 1; /* three;\n four; */ SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
    expect(split('# a MySQL comment; still a comment\nSELECT 1;', 'mysql')).toEqual(['SELECT 1']);
    expect(split('/*!40101 SET NAMES utf8 */;\nSELECT 1;', 'mysql')).toEqual(['SELECT 1']);
  });

  it('keeps PostgreSQL dollar-quoted bodies whole', () => {
    const sql = 'CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;\nDO $body$ BEGIN PERFORM 1; END $body$;\nSELECT 3;';
    expect(split(sql)).toEqual(['CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql', 'DO $body$ BEGIN PERFORM 1; END $body$', 'SELECT 3']);
  });

  it('ends SQL Server batches at GO on its own line', () => {
    const sql = 'CREATE TABLE [dbo].[a] ([id] int)\nGO\nSET ANSI_NULLS ON\ngo 2\nSELECT [go] FROM t\nGO';
    expect(split(sql, 'sqlserver')).toEqual(['CREATE TABLE [dbo].[a] ([id] int)', 'SET ANSI_NULLS ON', 'SELECT [go] FROM t']);
  });

  it('follows the mysql client DELIMITER command', () => {
    const sql = 'DELIMITER ;;\nCREATE TRIGGER t BEFORE INSERT ON x FOR EACH ROW BEGIN SET NEW.a = 1; END ;;\nDELIMITER ;\nSELECT 1;';
    expect(split(sql, 'mysql')).toEqual(['CREATE TRIGGER t BEFORE INSERT ON x FOR EACH ROW BEGIN SET NEW.a = 1; END', 'SELECT 1']);
  });

  it('keeps a SQLite trigger body in one statement', () => {
    const sql = 'CREATE TRIGGER t AFTER UPDATE ON x BEGIN UPDATE y SET a = CASE WHEN 1 THEN 2 END; DELETE FROM z; END;\nSELECT 1;';
    expect(split(sql, 'sqlite')).toEqual(['CREATE TRIGGER t AFTER UPDATE ON x BEGIN UPDATE y SET a = CASE WHEN 1 THEN 2 END; DELETE FROM z; END', 'SELECT 1']);
  });

  it('numbers lines from 1', () => {
    expect(splitStatements('\n-- note\nSELECT 1;\n\nSELECT\n2;', 'postgres').map((s) => s.line)).toEqual([3, 5]);
  });
});
