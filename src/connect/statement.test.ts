import { describe, expect, it } from 'vitest';
import { blankLiterals, statementProblem } from './statement';

describe('the statement check', () => {
  it('lets one reading statement through, with or without a trailing semicolon', () => {
    for (const q of ['SELECT * FROM t', 'select 1;', '  WITH x AS (SELECT 1) SELECT * FROM x', 'SHOW TABLES', 'DESCRIBE t', 'EXPLAIN SELECT 1', '(SELECT 1) UNION (SELECT 2)', "SELECT 'a; DROP TABLE t' AS s", 'SELECT * FROM t -- DELETE FROM t\n', 'SELECT /* ; */ 1', "SELECT 'it''s'"])
      expect(statementProblem(q), q).toBeUndefined();
  });

  it('refuses more than one statement, a statement that writes, and an empty one', () => {
    expect(statementProblem('SELECT 1; DELETE FROM t')).toMatch(/One statement at a time/);
    expect(statementProblem('DELETE FROM t')).toMatch(/not DELETE/);
    expect(statementProblem('INSERT INTO t VALUES (1)')).toMatch(/not INSERT/);
    expect(statementProblem('DROP TABLE t')).toMatch(/not DROP/);
    expect(statementProblem('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x')).toMatch(/writes, creates or changes/);
    expect(statementProblem('SELECT * INTO new_table FROM t')).toMatch(/writes, creates or changes/);
    expect(statementProblem('PRAGMA writable_schema = 1')).toMatch(/not PRAGMA/);
    expect(statementProblem('ATTACH DATABASE x AS y')).toMatch(/not ATTACH/);
    expect(statementProblem('')).toMatch(/empty/);
    expect(statementProblem('-- nothing')).toMatch(/empty/);
    expect(statementProblem('COPY t TO \'/tmp/x\'')).toMatch(/not COPY/);
  });

  it('blanks comments and strings, keeping their length so offsets hold', () => {
    const sql = "SELECT 'a;b' -- c;\n/* d; */ \"e;\" `f;` $$g;$$ FROM t";
    const blank = blankLiterals(sql);
    expect(blank).toHaveLength(sql.length);
    expect(blank).not.toContain(';');
    expect(blank.startsWith('SELECT ')).toBe(true);
    expect(blank.endsWith(' FROM t')).toBe(true);
    // An unterminated string runs to the end.
    expect(blankLiterals("SELECT 'open")).toBe("SELECT '   '");
  });
});
