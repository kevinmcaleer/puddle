import { describe, expect, it } from 'vitest';
import { flow, src, step } from '../../tests/helpers/projects';
import { compile } from './compile';
import { CompileError } from './errors';
import { cleanCustomSql, customSqlProblem, lexSql } from './customSql';
import { customSqlErrorLine } from './steps';
import { ACCEPTED, REFUSED } from '../../tests/helpers/customSqlCorpus';

describe('custom SQL checks', () => {
  it.each(ACCEPTED)('accepts %s', (sql) => {
    expect(customSqlProblem(sql)).toBeUndefined();
  });

  it.each(REFUSED)('refuses %s', (sql, reason) => {
    const problem = customSqlProblem(sql);
    if (reason.source === '^$') {
      // Comments hide nothing: the query is accepted and what was in them never reaches DuckDB.
      expect(problem).toBeUndefined();
      expect(cleanCustomSql(sql)).not.toMatch(/read_csv|\)\s*$/);
      return;
    }
    expect(problem).toMatch(reason);
  });

  it('lexes strings, quoted names and comments the way DuckDB does', () => {
    const kinds = lexSql(`SELECT 'it''s', "a ""b""" -- c\n/* d /* e */ */ 1.5e-3`).map((t) => [t.kind, t.text]);
    expect(kinds).toEqual([
      ['word', 'SELECT'],
      ['string', "'it''s'"],
      ['op', ','],
      ['quoted', '"a ""b"""'],
      ['comment', '-- c'],
      ['comment', '/* d /* e */ */'],
      ['number', '1.5e-3'],
    ]);
  });

  it('drops comments, keeping line breaks, and a trailing ;', () => {
    expect(cleanCustomSql('SELECT 1 -- one\nFROM input; -- done\n')).toBe('SELECT 1       \nFROM input');
  });
});

describe('custom SQL step', () => {
  const project = (query: string) =>
    flow({
      sources: [src({ id: 'cust', format: 'csv' })],
      nodes: [
        { id: 'src', type: 'source', sourceId: 'cust' },
        { id: 't', type: 'transform', steps: [step('s1', 'trimWhitespace', { columns: ['name'] }), step('s2', 'customSql', { query })] },
      ],
      wires: [['src', 't']],
    });

  it('binds input to the previous step and runs the query as a subquery', () => {
    expect(compile(project('SELECT region, count(*) AS n\nFROM input -- per region\nGROUP BY 1;'), { nodeId: 't' }).sql).toMatchSnapshot();
  });

  it('refuses before anything runs, naming the step and the reason', () => {
    expect(() => compile(project("SELECT * FROM read_csv('src_cust.csv')"), { nodeId: 't' })).toThrow(CompileError);
    expect(() => compile(project("SELECT * FROM read_csv('src_cust.csv')"), { nodeId: 't' })).toThrow(/calling read_csv\(\) isn’t allowed/);
  });

  it('finds the line of the query a DuckDB error points at', () => {
    const query = 'SELECT region,\n  -- the total\n  sum(totl)\nFROM input\nGROUP BY 1';
    const sql = compile(project(query), { nodeId: 't' }).sql;
    const line = sql.split('\n').findIndex((l) => l.includes('sum(totl)')) + 1;
    const error = `Binder Error: Referenced column "totl" not found in FROM clause!\n\nLINE ${line}:   sum(totl)\n          ^`;
    expect(customSqlErrorLine(sql, query, error)).toEqual({ line: 3, text: 'sum(totl)' });
    expect(customSqlErrorLine(sql, query, 'Binder Error: no line')).toBeUndefined();
    expect(customSqlErrorLine(sql, query, 'LINE 1: WITH')).toBeUndefined();
  });
});
