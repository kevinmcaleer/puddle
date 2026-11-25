import { describe, expect, it } from 'vitest';
import { isScript, readScript, scriptTableRefs, scriptTables, splitScript, sqlReads } from './sqlScript';

const inputs = [{ port: 0, label: 'orders' }];
const read = (sql: string) => readScript(sql, inputs, []);
const queries = (sql: string) => {
  const r = read(sql);
  if ('problem' in r) throw new Error(r.problem);
  return r.statements.map((s) => s.query);
};

describe('statements that change a table in a script', () => {
  it('declares a table by its columns, with no rows and the constraints left out', () => {
    expect(splitScript('CREATE TABLE people (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL, born DECIMAL(4, 0), PRIMARY KEY (id))')).toEqual({
      statements: [{ table: 'people', label: 'people', change: 'declare', query: 'SELECT CAST(NULL AS INTEGER) AS "id", CAST(NULL AS VARCHAR) AS "name", CAST(NULL AS DECIMAL(4, 0)) AS "born" WHERE false' }],
    });
    expect(splitScript('CREATE TABLE t (id)')).toEqual({ problem: expect.stringMatching(/give each column a name and a type/) });
  });

  it('reads INSERT as the table’s rows with the new ones after them, by position or by name', () => {
    expect(queries("CREATE TABLE t (id INT, name VARCHAR); INSERT INTO t VALUES (1, 'a'), (2, 'b')")[1]).toBe(`SELECT * FROM "t"\nUNION ALL\nSELECT * FROM (\nVALUES (1, 'a'), (2, 'b')\n)`);
    expect(queries("CREATE TABLE t (id INT, name VARCHAR); INSERT INTO t (name) VALUES ('c')")[1]).toBe(`SELECT * FROM "t"\nUNION ALL BY NAME\nSELECT * FROM (\nVALUES ('c')\n) AS "__puddle_rows"("name")`);
    expect(queries('CREATE TABLE t AS SELECT * FROM orders; INSERT INTO t BY NAME SELECT * FROM orders WHERE total > 5')[1]).toMatch(/UNION ALL BY NAME\nSELECT \* FROM \(\nSELECT \* FROM orders WHERE total > 5\n\)$/);
    expect(read('CREATE TABLE t AS SELECT 1 AS id; INSERT INTO t SELECT 1 RETURNING *')).toEqual({ problem: expect.stringMatching(/can’t return rows/) });
    expect(read('CREATE TABLE t AS SELECT 1 AS id; INSERT INTO t SELECT 1 ON CONFLICT DO NOTHING')).toEqual({ problem: expect.stringMatching(/ON CONFLICT/) });
    expect(read('CREATE TABLE t AS SELECT 1 AS id; INSERT INTO t DEFAULT VALUES')).toEqual({ problem: expect.stringMatching(/give the rows to insert/) });
  });

  it('reads UPDATE as the table with the columns replaced where the condition holds', () => {
    expect(queries("CREATE TABLE t AS SELECT * FROM orders; UPDATE t SET status = upper(status), total = total * 2 WHERE status = 'pending'")[1]).toBe(
      `SELECT * REPLACE (CASE WHEN (status = 'pending') IS TRUE THEN (upper(status)) ELSE "status" END AS "status", CASE WHEN (status = 'pending') IS TRUE THEN (total * 2) ELSE "total" END AS "total") FROM "t"`,
    );
    expect(queries('CREATE TABLE t AS SELECT * FROM orders; UPDATE t SET total = 0')[1]).toBe('SELECT * REPLACE ((0) AS "total") FROM "t"');
    expect(read('CREATE TABLE t AS SELECT * FROM orders; UPDATE t SET total = 0 FROM orders')).toEqual({ problem: expect.stringMatching(/UPDATE \.\.\. FROM/) });
    expect(read('CREATE TABLE t AS SELECT * FROM orders; UPDATE t SET total = 0, total = 1')).toEqual({ problem: 'set total once' });
  });

  it('reads DELETE as the rows the condition doesn’t hold for, nulls kept as DuckDB keeps them', () => {
    expect(queries('CREATE TABLE t AS SELECT * FROM orders; DELETE FROM t WHERE total < 5')[1]).toBe('SELECT * FROM "t" WHERE (total < 5) IS NOT TRUE');
    expect(queries('CREATE TABLE t AS SELECT * FROM orders; DELETE FROM t')[1]).toBe('SELECT * FROM "t" WHERE false');
    expect(read('CREATE TABLE t AS SELECT * FROM orders; DELETE FROM t USING orders WHERE true')).toEqual({ problem: expect.stringMatching(/USING/) });
  });

  it('reads ALTER TABLE’s column changes and RENAME TO', () => {
    const base = 'CREATE TABLE t AS SELECT * FROM orders; ';
    expect(queries(`${base}ALTER TABLE t ADD COLUMN note VARCHAR DEFAULT 'none'`)[1]).toBe(`SELECT *, CAST(('none') AS VARCHAR) AS "note" FROM "t"`);
    expect(queries(`${base}ALTER TABLE t ADD flag BOOLEAN`)[1]).toBe('SELECT *, CAST(NULL AS BOOLEAN) AS "flag" FROM "t"');
    expect(queries(`${base}ALTER TABLE t DROP COLUMN status`)[1]).toBe('SELECT * EXCLUDE ("status") FROM "t"');
    expect(queries(`${base}ALTER TABLE t RENAME COLUMN total TO amount`)[1]).toBe('SELECT * RENAME ("total" AS "amount") FROM "t"');
    expect(queries(`${base}ALTER TABLE t ALTER COLUMN total TYPE INTEGER`)[1]).toBe('SELECT * REPLACE (CAST("total" AS INTEGER) AS "total") FROM "t"');
    expect(queries(`${base}ALTER TABLE t ALTER total SET DATA TYPE VARCHAR USING total || ' GBP'`)[1]).toBe(`SELECT * REPLACE (CAST((total || ' GBP') AS VARCHAR) AS "total") FROM "t"`);
    expect(read(`${base}ALTER TABLE t ALTER COLUMN total SET DEFAULT 0`)).toEqual({ problem: expect.stringMatching(/keep rows, not defaults/) });
    expect(splitScript('ALTER VIEW v RENAME TO w')).toEqual({ problem: expect.stringMatching(/^ALTER VIEW isn’t something a script can do/) });
    expect(scriptTables(`${base}CREATE TABLE u AS SELECT 1; ALTER TABLE t RENAME TO sales`)).toEqual(['sales', 'u']);
    expect(read(`${base}CREATE TABLE u AS SELECT 1; ALTER TABLE t RENAME TO u`)).toEqual({ problem: expect.stringMatching(/already a table u/) });
  });

  it('drops a table, so later statements can’t read it and it isn’t one of the script’s tables', () => {
    expect(scriptTables('CREATE TABLE a AS SELECT 1; CREATE TABLE b AS SELECT 2; DROP TABLE a')).toEqual(['b']);
    expect(read('CREATE TABLE a AS SELECT 1; DROP TABLE a; SELECT * FROM a')).toEqual({ problem: expect.stringMatching(/no table a/) });
    expect(read('DROP TABLE IF EXISTS gone; CREATE TABLE a AS SELECT 1')).toMatchObject({ statements: [{ table: 'a' }] });
    expect(read('DROP TABLE nope; CREATE TABLE a AS SELECT 1')).toEqual({ problem: expect.stringMatching(/there’s no table nope to drop/) });
    expect(read('DROP TABLE IF EXISTS gone')).toEqual({ problem: expect.stringMatching(/write a query/) });
    // Made again after the drop: a new table of the same name.
    expect(scriptTables('CREATE TABLE a AS SELECT 1; DROP TABLE a; CREATE TABLE a AS SELECT 2')).toEqual(['a']);
  });

  it('may make a table again with CREATE OR REPLACE, never with plain CREATE', () => {
    expect(queries('CREATE TABLE a AS SELECT 1 AS x; CREATE OR REPLACE TABLE a AS SELECT x + 1 AS x FROM a')).toHaveLength(2);
    expect(read('CREATE TABLE a AS SELECT 1; CREATE TABLE a AS SELECT 2')).toEqual({ problem: expect.stringMatching(/creates a twice/) });
    expect(scriptTables('CREATE TABLE a AS SELECT 1; CREATE OR REPLACE TABLE a AS SELECT 2')).toEqual(['a']);
  });

  it('changes only tables the script made: a table it reads is copied first', () => {
    expect(read('UPDATE orders SET total = 0')).toEqual({ problem: expect.stringMatching(/^orders is a table this node reads, which a script can’t change: make a table of your own from it first, CREATE TABLE my_orders AS SELECT \* FROM orders/) });
    expect(read('INSERT INTO nowhere VALUES (1)')).toEqual({ problem: expect.stringMatching(/there’s no table nowhere to change/) });
    expect(read('CREATE TABLE t AS SELECT 1 AS id; INSERT INTO t SELECT * FROM other')).toEqual({ problem: expect.stringMatching(/no table other/) });
  });

  it('counts as a script, and marks the tables it changes and reads where they are written', () => {
    expect(isScript('DELETE FROM t')).toBe(true);
    expect(isScript('UPDATE t SET a = (')).toBe(true);
    const sql = 'CREATE TABLE t AS SELECT * FROM orders; DELETE FROM t WHERE id IN (SELECT id FROM orders); UPDATE gone SET a = 1';
    const marks = scriptTableRefs(sql, ['orders']).map((r) => [sql.slice(r.start, r.end), r.kind]);
    expect(marks).toEqual([
      ['t', 'made'],
      ['orders', 'input'],
      ['t', 'made'],
      ['orders', 'input'],
      ['gone', 'unknown'],
    ]);
    expect(sqlReads('CREATE TABLE t AS SELECT 1; INSERT INTO t SELECT * FROM customers')).toEqual(['customers']);
  });
});
