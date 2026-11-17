import { expect, test } from '@playwright/test';
import { addFiles, expectRows, expectSql, fixture, node, openApp, queriesOnCanvas, selectNode } from './helpers/app';

// Regression (#270): renaming a node left the SQL that read it by name with no such table.
test('renaming a node rewrites the SQL that reads it by name, and one undo puts both back', async ({ page }) => {
  await openApp(page);
  await queriesOnCanvas(page);
  await addFiles(page, [fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok');
  await selectNode(page, 'shop-orders.csv');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /^SQL/ }).click();
  await expect(node(page, 'SQL 1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  const query = page.getByLabel('SQL query');
  await query.fill('SELECT status, count(*) AS n FROM "shop-orders.csv" GROUP BY 1');
  await query.press('Control+Enter');
  await expect(node(page, 'SQL 1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expectRows(page, 2);

  await selectNode(page, 'shop-orders.csv');
  await page.getByLabel('Node name').fill('orders');
  await page.getByLabel('Node name').press('Enter');
  await expect(node(page, 'orders')).toBeVisible();
  await expect(node(page, 'SQL 1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await selectNode(page, 'SQL 1');
  await expectSql(page.getByLabel('SQL query'), 'SELECT status, count(*) AS n FROM orders GROUP BY 1');
  await expectRows(page, 2);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(node(page, 'shop-orders.csv')).toBeVisible();
  await expectSql(page.getByLabel('SQL query'), 'SELECT status, count(*) AS n FROM "shop-orders.csv" GROUP BY 1');
  await expect(node(page, 'SQL 1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
});
