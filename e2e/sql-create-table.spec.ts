import { expect, test } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp, selectNode } from './helpers/app';

test('CREATE OR REPLACE TABLE in a Query’s SQL view makes a table with a node of its own on the canvas', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Query/ }).click();
  const designer = page.getByTestId('query-designer');
  await designer.getByRole('tab', { name: 'SQL' }).click();
  const sql = designer.getByLabel('SQL', { exact: true });
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
  await expect(page.getByLabel('SQL query')).toHaveValue('CREATE OR REPLACE TABLE big_orders AS SELECT * FROM input WHERE total > 5');
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
  await expect(page.getByLabel('SQL query')).toHaveValue(/^CREATE OR REPLACE TABLE table1 AS\nSELECT \*\nFROM \(VALUES/);

  // Rewriting the query renames the table's node and changes its rows.
  await page.getByLabel('SQL query').fill('CREATE OR REPLACE TABLE sizes AS\nSELECT * FROM (VALUES (\'S\'), (\'M\'), (\'L\')) AS t(size)');
  await page.getByLabel('SQL query').press('Control+Enter');
  await expect(node(page, 'sizes')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'table1')).toHaveCount(0);
  await selectNode(page, 'sizes');
  await expect(page.getByTestId('results-title')).toHaveText('sizes');
  await expectRows(page, 3);
});
