import { expect, test } from '@playwright/test';
import { addFiles, expectRows, expectSql, fixture, node, openApp, queriesOnCanvas, selectNode } from './helpers/app';

test('a node’s SQL is edited beside its rows at the bottom of the screen, for a SQL node and for a Query', async ({ page }) => {
  await openApp(page);
  await queriesOnCanvas(page);
  await addFiles(page, [fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /^SQL/ }).click();
  await selectNode(page, 'SQL 1');

  // The editor sits in the dock, to the left of the rows and level with them; the inspector says where it went.
  const dock = page.getByTestId('sql-dock');
  const sql = dock.getByLabel('SQL query');
  await expect(sql).toBeVisible();
  await expect(page.getByTestId('inspector-sql').getByTestId('sql-docked-note')).toBeVisible();
  const [editor, rows] = await Promise.all([dock.boundingBox(), page.getByTestId('results-table').boundingBox()]);
  expect(editor!.x + editor!.width).toBeLessThanOrEqual(rows!.x + 1);
  expect(Math.abs(editor!.y - rows!.y)).toBeLessThan(40);

  // Edited there, the rows beside it follow.
  await sql.fill('select * from input1 where total > 5');
  await sql.press('Control+Enter');
  await expectSql(sql, 'SELECT * FROM input1 WHERE total > 5');
  await expectRows(page, 3);

  // With the results hidden there is no dock, and the editor is in the inspector as before.
  await page.getByRole('button', { name: 'Hide results' }).click();
  await expect(dock).toHaveCount(0);
  await expectSql(page.getByTestId('inspector-sql').getByLabel('SQL query'), 'SELECT * FROM input1 WHERE total > 5');
  await page.getByRole('button', { name: 'Show results' }).click();
  await expect(dock.getByLabel('SQL query')).toBeVisible();

  // A Query's SQL view docks the same way, with the design it is written from still in view above.
  await selectNode(page, 'shop-orders.csv');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Query/ }).click();
  const designer = page.getByTestId('query-designer');
  await designer.getByRole('tab', { name: 'SQL' }).click();
  await expect(dock.getByRole('textbox', { name: 'SQL', exact: true })).toBeVisible();
  await expect(designer.getByTestId('query-grid')).toBeVisible();
  await expect(designer.getByTestId('sql-docked-note')).toBeVisible();
});
