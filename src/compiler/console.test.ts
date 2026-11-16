import { describe, expect, it } from 'vitest';
import { flow, src } from '../../tests/helpers/projects';
import { compileConsole, CONSOLE_ROW_LIMIT, consoleProblem } from './console';

const project = flow({
  sources: [src({ id: 'a', format: 'csv' })],
  nodes: [{ id: 'a', type: 'source', sourceId: 'a' }],
  wires: [],
});

describe('the scratch console', () => {
  it('reads the viewed rows as input, and nothing else', () => {
    expect(consoleProblem('SELECT count(*) FROM input')).toBeUndefined();
    expect(consoleProblem('SELECT * FROM input1')).toMatch(/no table input1/);
    expect(consoleProblem("SELECT * FROM read_csv('x.csv')")).toMatch(/read_csv/);
    expect(consoleProblem('')).toBe('write a query, such as SELECT * FROM input');
  });

  it('wraps the viewed node’s SQL as input around the query, cut to the row limit', () => {
    const sql = compileConsole(project, { nodeId: 'a' }, 'SELECT id FROM input -- just ids\n');
    expect(sql).toMatch(/^WITH "input" AS \(\nWITH "n_a" AS \(SELECT \* FROM read_csv\('src_a\.csv'.*\)\)\nSELECT \* FROM "n_a"\n\)\nSELECT \* FROM \(\nSELECT id FROM input\n\) LIMIT 200$/s);
    expect(compileConsole(project, { nodeId: 'a' }, 'SELECT 1', 5)).toMatch(/LIMIT 5$/);
    expect(CONSOLE_ROW_LIMIT).toBe(200);
  });

  it('accepts a script that creates tables from input, for the SQL node it becomes, and never runs one itself', () => {
    expect(consoleProblem('CREATE OR REPLACE TABLE big AS SELECT * FROM input WHERE total > 5')).toBeUndefined();
    expect(consoleProblem('CREATE TABLE a AS SELECT * FROM input; SELECT count(*) FROM a')).toBeUndefined();
    expect(consoleProblem('CREATE TABLE input AS SELECT 1')).toBe('input is already the name of an input: give the table another name');
    expect(consoleProblem('CREATE TABLE a (id INT)')).toMatch(/give a its rows with AS and a query/);
    expect(consoleProblem('CREATE TABLE a AS SELECT * FROM other')).toMatch(/no table other/);
    expect(() => compileConsole(project, { nodeId: 'a' }, 'CREATE TABLE big AS SELECT * FROM input')).toThrow(/runs in a SQL node/);
  });

  it('refuses a query the guard refuses before any SQL is built', () => {
    expect(() => compileConsole(project, { nodeId: 'a' }, "COPY input TO 'x.csv'")).toThrow(/can’t run/);
  });
});
