import { describe, expect, it } from 'vitest';
import { flow, src } from '../../tests/helpers/projects';
import { compileShellDescribe, compileShellQuery, likePattern, readShellCommand, schemaStatement, shellCommandProblem, shellNames } from './shell';

const project = flow({
  sources: [src({ id: 'a', format: 'csv' }), src({ id: 'b', format: 'csv' })],
  nodes: [
    { id: 'a', type: 'source', sourceId: 'a', name: 'orders' },
    { id: 'b', type: 'source', sourceId: 'b', name: 'Shop Customers' },
    { id: 'c', type: 'source', sourceId: 'b', name: 'twin' },
    { id: 'd', type: 'source', sourceId: 'a', name: 'Twin' },
  ],
  wires: [],
});

describe('reading a shell command', () => {
  it('splits statements at semicolons outside strings and comments, and reads each as the shell does', () => {
    expect(readShellCommand("SELECT ';' FROM orders; -- a note\nDESCRIBE orders;  SHOW TABLES").map((s) => s.kind)).toEqual(['query', 'describe', 'tables']);
    expect(readShellCommand('  ')).toEqual([]);
    expect(readShellCommand('FROM orders')).toEqual([{ kind: 'query', text: 'FROM orders', query: 'FROM orders' }]);
    expect(readShellCommand("UPDATE t SET a = 1; INSERT INTO t VALUES (2)").map((s) => s.kind)).toEqual(['change', 'change']);
  });

  it('reads DESCRIBE, SHOW, SUMMARIZE and EXPLAIN of a table by name or of a query', () => {
    expect(readShellCommand('DESCRIBE "Shop Customers"')).toEqual([{ kind: 'describe', text: 'DESCRIBE "Shop Customers"', how: 'DESCRIBE', query: 'SELECT * FROM "Shop Customers"' }]);
    expect(readShellCommand('show orders')[0]).toMatchObject({ how: 'DESCRIBE', query: 'SELECT * FROM orders' });
    expect(readShellCommand('SUMMARIZE SELECT total FROM orders')[0]).toMatchObject({ how: 'SUMMARIZE', query: 'SELECT total FROM orders' });
    expect(readShellCommand('EXPLAIN SELECT 1')[0]).toMatchObject({ how: 'EXPLAIN', query: 'SELECT 1' });
    expect(readShellCommand('SHOW ALL TABLES')[0]).toMatchObject({ kind: 'tables' });
    expect(readShellCommand('DESCRIBE')[0]).toMatchObject({ kind: 'refused', problem: expect.stringMatching(/say what to describe/) });
  });

  it('reads dot commands, and says what Puddle does for the ones it has no use for', () => {
    expect(readShellCommand('.tables ord%')).toEqual([{ kind: 'tables', text: '.tables ord%', pattern: 'ord%' }]);
    expect(readShellCommand('.schema orders;')).toEqual([{ kind: 'dot', text: '.schema orders;', name: 'schema', arg: 'orders' }]);
    expect(readShellCommand('.open sales.duckdb')[0]).toMatchObject({ kind: 'refused', problem: expect.stringMatching(/^\.open isn’t something the shell can do here: .*Add menu/) });
    expect(readShellCommand('.nope')[0]).toMatchObject({ kind: 'refused', problem: 'the shell doesn’t know .nope: type .help to see what it can do' });
  });

  it('refuses what the browser can’t do, saying what to do instead', () => {
    expect(readShellCommand("ATTACH 'sales.duckdb' AS s")[0]).toMatchObject({ kind: 'refused', problem: expect.stringMatching(/^ATTACH isn’t something the shell can do here: .*as a source from the Add menu/) });
    expect(readShellCommand("COPY orders TO 'x.csv'")[0]).toMatchObject({ problem: expect.stringMatching(/Export/) });
    expect(readShellCommand('INSTALL spatial')[0]).toMatchObject({ problem: expect.stringMatching(/loads the DuckDB extensions it needs itself/) });
    expect(readShellCommand('BEGIN TRANSACTION')[0]).toMatchObject({ problem: expect.stringMatching(/Ctrl\+Z/) });
    expect(readShellCommand('FROBNICATE')[0]).toMatchObject({ problem: 'the shell doesn’t know FROBNICATE: type .help to see what it can do' });
  });
});

describe('the shell’s tables', () => {
  it('are the nodes by their names, but not a name two nodes share, and the viewed node as input', () => {
    expect([...shellNames(project, 'a')]).toEqual([
      ['orders', 'a'],
      ['shop customers', 'b'],
      ['input', 'a'],
    ]);
    expect(shellNames(project).has('input')).toBe(false);
  });

  it('may be read by queries, which can’t read anything else', () => {
    const names = shellNames(project, 'a');
    expect(shellCommandProblem('SELECT * FROM orders JOIN "Shop Customers" USING (id)', names)).toBeUndefined();
    expect(shellCommandProblem('SELECT * FROM twin', names)).toMatch(/no table twin/);
    expect(shellCommandProblem("SELECT * FROM read_csv('/etc/passwd')", names)).toMatch(/read_csv/);
    expect(shellCommandProblem('CREATE TABLE t (id)', names)).toMatch(/give each column a name and a type/);
    expect(shellCommandProblem('', names)).toBe('write a query, such as SELECT * FROM input');
  });

  it('compile each table a query reads around it, once, and cut it to the row limit', () => {
    const names = shellNames(project, 'a');
    const sql = compileShellQuery(project, names, 'SELECT * FROM orders o JOIN orders p USING (id) -- twice\n', 10);
    expect(sql.match(/"orders" AS \(/g)).toHaveLength(1);
    expect(sql).toMatch(/^WITH "orders" AS \(\nWITH "n_a" AS .*\n\)\nSELECT \* FROM \(\nSELECT \* FROM orders o JOIN orders p USING \(id\)\n\) LIMIT 10$/s);
    expect(compileShellQuery(project, names, 'SELECT 1')).toBe('SELECT * FROM (\nSELECT 1\n)');
    const describe = readShellCommand('SUMMARIZE "Shop Customers"')[0]!;
    if (describe.kind !== 'describe') throw new Error('not a describe');
    expect(compileShellDescribe(project, names, describe)).toMatch(/^SUMMARIZE WITH "shop customers" AS \(/);
  });

  it('write .schema as DuckDB’s shell does, and match .tables patterns as LIKE', () => {
    expect(schemaStatement('orders', [{ name: 'id', type: 'INTEGER' }, { name: 'order date', type: 'DATE' }])).toBe('CREATE TABLE orders(id INTEGER, "order date" DATE);');
    expect(schemaStatement('Shop Customers', [{ name: 'id', type: 'BIGINT' }])).toBe('CREATE TABLE "Shop Customers"(id BIGINT);');
    expect(likePattern('ord%', 'Orders')).toBe(true);
    expect(likePattern('o_ders', 'orders')).toBe(true);
    expect(likePattern('ord', 'orders')).toBe(false);
  });
});
