import { describe, expect, it } from 'vitest';
import { renameTableInSql, sqlUsesName } from './renameTable';

const names = ['input1', 'input', 'sales.csv'];
const rename = (sql: string, to = 'sales', from = 'sales.csv', known = names) => renameTableInSql(sql, known, from, to);

describe('renaming a table in written SQL', () => {
  it('rewrites the name where the query reads it, bare when the new name needs no quotes', () => {
    expect(rename('SELECT * FROM "sales.csv"')).toBe('SELECT * FROM sales');
    expect(rename('SELECT * FROM "Sales.CSV" s JOIN "sales.csv" t USING (id)')).toBe('SELECT * FROM sales s JOIN sales t USING (id)');
  });

  it('quotes a new name that needs it', () => {
    expect(rename('SELECT * FROM sales', 'Sales 2024', 'sales', ['input1', 'sales'])).toBe('SELECT * FROM "Sales 2024"');
    expect(rename('SELECT * FROM sales', 'order', 'sales', ['input1', 'sales'])).toBe('SELECT * FROM "order"');
  });

  it('renames the columns qualified by the table in a statement that reads it', () => {
    expect(rename('SELECT "sales.csv".amount, "sales.csv"."region" FROM "sales.csv" WHERE "sales.csv".amount > 1')).toBe(
      'SELECT sales.amount, sales."region" FROM sales WHERE sales.amount > 1',
    );
  });

  it('leaves strings, comments and columns of the same spelling alone', () => {
    const known = ['input1', 'sales'];
    expect(rename("SELECT 'sales' AS sales, t.sales -- from sales\nFROM sales /* sales */ t", 'orders', 'sales', known)).toBe(
      "SELECT 'sales' AS sales, t.sales -- from sales\nFROM orders /* sales */ t",
    );
  });

  it('leaves a CTE of the same name, and the reads of it, alone', () => {
    const sql = 'WITH sales AS (SELECT 1 AS n) SELECT * FROM sales';
    expect(rename(sql, 'orders', 'sales', ['input1', 'sales'])).toBe(sql);
  });

  it('leaves the other names of the input, and other inputs, alone', () => {
    expect(rename('SELECT * FROM input1 JOIN customers USING (id)', 'orders', 'sales', ['input1', 'sales', 'input2', 'customers'])).toBe('SELECT * FROM input1 JOIN customers USING (id)');
  });

  it('renames through a script, but not a table the script makes under that name', () => {
    const known = ['input1', 'sales'];
    expect(rename('CREATE TABLE big AS SELECT * FROM sales WHERE amount > 10;\nSELECT sales.id FROM sales JOIN big USING (id)', 'orders', 'sales', known)).toBe(
      'CREATE TABLE big AS SELECT * FROM orders WHERE amount > 10;\nSELECT orders.id FROM orders JOIN big USING (id)',
    );
    const shadowed = 'CREATE TABLE sales AS SELECT * FROM input1;\nSELECT * FROM sales';
    expect(rename(shadowed, 'orders', 'sales', known)).toBe(shadowed);
  });

  it('gives back text it cannot read as it is', () => {
    expect(rename('SELECT * FROM "sales.csv" /* open')).toBe('SELECT * FROM "sales.csv" /* open');
  });

  it('says whether SQL already uses a name', () => {
    expect(sqlUsesName('WITH t AS (SELECT 1) SELECT * FROM t', 'T')).toBe(true);
    expect(sqlUsesName("SELECT 't' FROM input -- t", 't')).toBe(false);
  });
});
