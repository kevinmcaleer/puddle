import { expect, test } from '@playwright/test';
import { addFiles, expectRows, expectSql, fixture, node, openApp, selectNode, sqlText } from './helpers/app';

test('CREATE OR REPLACE TABLE in a Query’s SQL view makes a table with a node of its own on the canvas', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Query/ }).click();
  const designer = page.getByTestId('query-designer');
  await designer.getByRole('tab', { name: 'SQL' }).click();
  const sql = page.getByRole('textbox', { name: 'SQL', exact: true });
  await sql.fill('CREATE OR REPLACE TABLE big_orders AS\nSELECT * FROM input1 WHERE total > 5');
  await sql.press('Control+Enter');

  // It runs as written, and says where the table went.
  await expect(designer.getByText('This query can’t run')).toHaveCount(0);
  await expect(designer.getByTestId('query-sql-kept')).toContainText('the table big_orders it creates has a node of its own on the canvas');
  await expectRows(page, 3);

  // On the canvas the table is a node wired from the Query, holding the table's rows.
  await page.getByRole('button', { name: 'Back to canvas' }).click();
  await expect(node(page, 'big_orders')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'big_orders')).toContainText('Script table · big_orders');
  await selectNode(page, 'big_orders');
  await expect(page.getByTestId('inspector-script-table')).toContainText('A table Query 1’s script creates.');
  await expect(page.getByTestId('results-title')).toHaveText('big_orders');
  await expectRows(page, 3);
});

test('CREATE TABLE in the console adds a SQL node and the table’s node, only when asked', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await page.getByTestId('console-toggle').click();
  const console = page.getByTestId('sql-console');
  const query = page.getByLabel('Console query');

  // Typing a script and clicking away adds nothing; the button says what it will do.
  await query.fill('CREATE OR REPLACE TABLE big_orders AS SELECT * FROM input WHERE total > 5');
  await console.getByText('Reads the rows of').click();
  await expect(console.getByText('This query can’t run')).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await console.getByRole('button', { name: 'Create table' }).click();

  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(node(page, 'SQL 1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'big_orders')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expectSql(page.getByLabel('SQL query'), 'CREATE OR REPLACE TABLE big_orders AS SELECT * FROM input WHERE total > 5');
  await selectNode(page, 'big_orders');
  await expectRows(page, 3);
});

test('Add › Table from SQL makes a table on the canvas from a query, with nothing wired in', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Table from SQL/ }).click();

  // A SQL node that makes its rows itself, and the table it creates as a node after it.
  await expect(node(page, 'SQL 1')).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });
  await expect(node(page, 'table1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expectSql(page.getByLabel('SQL query'), /^CREATE OR REPLACE TABLE table1 AS\nSELECT \*\nFROM \(VALUES/);

  // Rewriting the query renames the table's node and changes its rows.
  await page.getByLabel('SQL query').fill('CREATE OR REPLACE TABLE sizes AS\nSELECT * FROM (VALUES (\'S\'), (\'M\'), (\'L\')) AS t(size)');
  await page.getByLabel('SQL query').press('Control+Enter');
  await expect(node(page, 'sizes')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'table1')).toHaveCount(0);
  await selectNode(page, 'sizes');
  await expect(page.getByTestId('results-title')).toHaveText('sizes');
  await expectRows(page, 3);
});

test('emptying a Query’s SQL view goes back to the design instead of saying the empty query can’t run', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Query/ }).click();
  const designer = page.getByTestId('query-designer');
  await page.getByTestId('query-field-1-order_id').dblclick();
  await designer.getByRole('tab', { name: 'SQL' }).click();
  const sql = page.getByRole('textbox', { name: 'SQL', exact: true });
  await expectSql(sql, /^SELECT /);
  const design = await sqlText(sql);

  // Clearing the design's SQL and clicking away keeps nothing, so there is nothing to refuse.
  await sql.fill('');
  await page.getByText('Edit the SQL, then press').click();
  await expect(designer.getByText('This query can’t run')).toHaveCount(0);
  await expect(designer.getByRole('tab', { name: 'Design' })).toBeEnabled();

  // Clearing SQL that was kept as written discards it: the design is written here again, and runs.
  await sql.fill('SELECT order_id FROM input1 LIMIT 1 OFFSET 1');
  await sql.press('Control+Enter');
  await expect(designer.getByTestId('query-sql-kept')).toBeVisible();
  await sql.fill('');
  await page.getByText('Edit the SQL, then press').click();
  await expect(designer.getByText('This query can’t run')).toHaveCount(0);
  await expect(designer.getByTestId('query-sql-kept')).toHaveCount(0);
  await expectSql(sql, design);
  await expectRows(page, 5);
});
