import { describe, expect, it } from 'vitest';
import { flow, src } from '../../tests/helpers/projects';
import { compile, sqlNodeFiles, sqlProblem } from './compile';
import { fileSetFileName } from './fileSet';
import { compileScript, isScript, liftFileReads, readScript, scriptTables, splitScript, type ScriptFile } from './sqlScript';

const files: ScriptFile[] = [
  { name: 'log-1.parquet', registered: 'src_s_1.parquet' },
  { name: 'log-2.parquet', registered: 'src_s_2.parquet' },
  { name: 'sap_users.parquet', registered: 'src_s_3.parquet' },
];
const inputs = [{ port: 0, label: 'logs' }];
let n = 0;
const next = () => `f${++n}`;

describe('splitting a script', () => {
  it('reads CREATE [OR REPLACE] TABLE name AS query statements and a last query, past comments and strings with ;', () => {
    const split = splitScript(`-- the log
CREATE OR REPLACE TABLE log AS SELECT ';' AS x FROM input1;
create temp view "Users" as select 1;
CREATE TABLE IF NOT EXISTS docs AS SELECT * FROM log;
SELECT * FROM docs;`);
    expect(split).toEqual({
      statements: [
        { table: 'log', label: 'log', query: `SELECT ';' AS x FROM input1` },
        { table: 'users', label: 'Users', query: 'select 1' },
        { table: 'docs', label: 'docs', query: 'SELECT * FROM log' },
        { query: 'SELECT * FROM docs' },
      ],
    });
    expect(scriptTables('CREATE TABLE a AS SELECT 1; CREATE TABLE "B" AS SELECT 2')).toEqual(['a', 'B']);
  });

  it('refuses statements that do anything but make a table from a query', () => {
    expect(splitScript('CREATE TABLE t (id INT)')).toEqual({ problem: expect.stringMatching(/give t its rows with AS and a query/) });
    expect(splitScript('CREATE SCHEMA s')).toEqual({ problem: expect.stringMatching(/^CREATE SCHEMA isn’t something a script can do/) });
    expect(splitScript('CREATE TABLE main.t AS SELECT 1')).toEqual({ problem: expect.stringMatching(/without a schema/) });
    expect(splitScript('CREATE TABLE t AS')).toEqual({ problem: 'write the query t is made from after AS' });
  });

  it('knows a script from a plain query', () => {
    expect(isScript('SELECT * FROM input1;')).toBe(false);
    expect(isScript('CREATE TABLE a AS SELECT 1')).toBe(true);
    expect(isScript('SELECT 1; SELECT 2')).toBe(true);
  });
});

describe('file reads', () => {
  it('lift read_parquet with a pattern into a CTE reading exactly the files it matches, options kept', () => {
    const lifted = liftFileReads(`SELECT * FROM read_parquet('log-*.parquet', union_by_name = true) WHERE x`, files, next);
    expect(lifted).toEqual({ query: 'SELECT * FROM "f1" WHERE x', reads: [{ cte: 'f1', relation: `read_parquet(['src_s_1.parquet', 'src_s_2.parquet'], union_by_name = true)` }] });
  });

  it('lift a file named in place of a table, and a list of names', () => {
    expect(liftFileReads(`SELECT * FROM 'sap_users.parquet' u JOIN read_csv_auto(['log-1.parquet', '*-2.parquet']) l ON true`, files, next)).toMatchObject({
      query: 'SELECT * FROM "f2" u JOIN "f3" l ON true',
      reads: [{ relation: `read_parquet(['src_s_3.parquet'])` }, { relation: `read_csv(['src_s_1.parquet', 'src_s_2.parquet'])` }],
    });
  });

  it('refuse names no wired file has, options that aren’t plain values, and readers given no name', () => {
    expect(liftFileReads(`SELECT * FROM read_parquet('*.csv')`, files, next)).toEqual({ problem: 'no file wired into this node matches *.csv' });
    expect(liftFileReads(`SELECT * FROM 'other.parquet'`, files, next)).toEqual({ problem: 'no file wired into this node is called other.parquet' });
    expect(liftFileReads(`SELECT * FROM 'x.parquet'`, [], next)).toEqual({ problem: expect.stringMatching(/^there are no files to read x.parquet from/) });
    expect(liftFileReads(`SELECT * FROM read_parquet('*.parquet', filename = (SELECT 1))`, files, next)).toEqual({ problem: 'read_parquet()’s options can only be plain values' });
    expect(liftFileReads(`SELECT * FROM read_parquet('*.parquet', secret = 'x')`, files, next)).toEqual({ problem: 'read_parquet() can’t take secret here' });
    expect(liftFileReads(`SELECT * FROM read_parquet(x)`, files, next)).toEqual({ problem: expect.stringMatching(/file name to read as text/) });
  });
});

describe('a script against its inputs and files', () => {
  it('lets each statement read the inputs, the tables before it and its files, and nothing else', () => {
    const ok = readScript(`CREATE TABLE log AS SELECT * FROM read_parquet('log-*.parquet'); CREATE TABLE docs AS SELECT * FROM log JOIN logs USING (id)`, inputs, files);
    expect(ok).toMatchObject({ statements: [{ table: 'log', query: 'SELECT * FROM "__puddle_file_1"' }, { table: 'docs' }] });
    expect(readScript('CREATE TABLE a AS SELECT * FROM b; CREATE TABLE b AS SELECT 1', inputs, files)).toEqual({ problem: expect.stringMatching(/^in a: there’s no table b/) });
    expect(readScript(`CREATE TABLE a AS SELECT * FROM read_text('x')`, inputs, files)).toEqual({ problem: expect.stringMatching(/read_text/) });
    expect(readScript('CREATE TABLE a AS SELECT 1; COPY a TO \'x.csv\'', inputs, files)).toEqual({ problem: expect.stringMatching(/^in statement 2: COPY isn’t allowed/) });
  });

  it('refuses a table named twice, after an input, or a query that isn’t last', () => {
    expect(readScript('CREATE TABLE a AS SELECT 1; CREATE OR REPLACE TABLE A AS SELECT 2', inputs, files)).toEqual({ problem: 'the script creates A twice: give each table its own name' });
    expect(readScript('CREATE TABLE logs AS SELECT 1', inputs, files)).toEqual({ problem: 'logs is already the name of an input: give the table another name' });
    expect(readScript('SELECT 1; CREATE TABLE a AS SELECT 2', inputs, files)).toEqual({ problem: expect.stringMatching(/^in statement 1: a query in the middle of a script does nothing/) });
  });

  it('compiles to one CTE per statement, each binding the inputs, the tables before it and its file reads', () => {
    const read = readScript(`CREATE TABLE log AS SELECT * FROM 'log-1.parquet'; SELECT count(*) FROM log`, inputs, files);
    if ('problem' in read) throw new Error(read.problem);
    expect(compileScript(read, [{ port: 0, label: 'logs', cte: 'n_l' }], (k) => `t${k}`)).toEqual([
      `t0 AS (WITH "input1" AS (SELECT * FROM n_l), "input" AS (SELECT * FROM n_l), "logs" AS (SELECT * FROM n_l), "__puddle_file_1" AS (SELECT * FROM read_parquet(['src_s_1.parquet']))\nSELECT * FROM (\nSELECT * FROM "__puddle_file_1"\n))`,
      `t1 AS (WITH "input1" AS (SELECT * FROM n_l), "input" AS (SELECT * FROM n_l), "logs" AS (SELECT * FROM n_l), "log" AS (SELECT * FROM t0)\nSELECT * FROM (\nSELECT count(*) FROM log\n))`,
    ]);
  });
});

describe('a SQL node with a script', () => {
  const logs = src({ id: 'logs', kind: 'files', format: 'parquet', fileSet: { files: [{ name: 'a.parquet', size: 1, lastModified: 1 }] } });
  const users = src({ id: 'users', format: 'csv', file: { originalName: 'users.csv', size: 1, lastModified: 1, headHash: 'h' } });
  const project = (query: string, table = 'log') =>
    flow({
      sources: [logs, users],
      nodes: [
        { id: 'l', type: 'source', sourceId: 'logs' },
        { id: 'u', type: 'source', sourceId: 'users' },
        { id: 'q', type: 'sql', sqlSpec: { query } },
        { id: 't', type: 'scriptTable', scriptTable: { table } },
      ],
      wires: [
        ['l', 'q', 0],
        ['u', 'q', 1],
        ['q', 't'],
      ],
    });

  it('may read the files of the file sets and file sources wired in', () => {
    expect(sqlNodeFiles(project('SELECT 1'), 'q')).toEqual([
      { name: 'a.parquet', registered: fileSetFileName('logs', logs.fileSet!.files[0]!) },
      { name: 'users.csv', registered: 'src_users.csv' },
    ]);
  });

  it('gives its rows as the last statement’s, and each table to the script table node holding it', () => {
    const p = project(`CREATE TABLE log AS SELECT * FROM 'a.parquet'; CREATE TABLE users AS FROM 'users.csv'`);
    expect(compile(p, { nodeId: 'q' }).sql).toMatch(/SELECT \* FROM "n_q_t1"$/);
    expect(compile(p, { nodeId: 't' }).sql).toMatch(/SELECT \* FROM "n_q_t0"$/);
    expect(() => compile(project('CREATE TABLE a AS SELECT 1', 'gone'), { nodeId: 't' })).toThrow('q’s script doesn’t create a table called gone.');
  });

  it('compiles a plain query exactly as before', () => {
    expect(compile(project('SELECT * FROM input1'), { nodeId: 'q' }).sql).toContain('"n_q" AS (WITH "input1"');
  });

  it('says why a script can’t run, as the inspector shows it', () => {
    expect(sqlProblem(project(`CREATE TABLE log AS SELECT * FROM 'b.parquet'`), 'q')).toBe('no file wired into this node is called b.parquet');
    expect(() => compile(project(`CREATE TABLE log AS SELECT * FROM 'b.parquet'`), { nodeId: 'q' })).toThrow('This script can’t run: no file wired into this node is called b.parquet.');
    expect(sqlProblem(project('SELECT * FROM input1'), 'q')).toBeUndefined();
  });
});
