import { expect, test } from '@playwright/test';
import { addFiles, fixture, node, openApp, queriesOnCanvas, selectNode } from './helpers/app';

test('the canvas tags imported tables and tables created with SQL', async ({ page }) => {
  await openApp(page);
  // On the canvas, a script's node and each table's node are cards of their own (in the panel's project they are one).
  await queriesOnCanvas(page);
  await addFiles(page, [fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'shop-orders.csv').getByTestId('node-table-tag')).toHaveText('Imported table');

  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Table from SQL/ }).click();
  const sql = page.getByLabel('SQL query');
  await sql.fill('CREATE OR REPLACE TABLE big_orders AS\nSELECT * FROM input1 WHERE total > 5');
  await sql.press('Control+Enter');

  // The table the script creates is tagged as one; the SQL node holding the script, and anything else, is not.
  await expect(node(page, 'big_orders')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'big_orders').getByTestId('node-table-tag')).toHaveText('SQL table');
  await expect(node(page, 'SQL 1').getByTestId('node-table-tag')).toHaveCount(0);
});

test('a node is renamed from its menu, with F2, and in the inspector', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });

  // From the node's menu.
  await node(page, 'shop-orders.csv').click({ button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: /Rename/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename node' });
  await expect(dialog.getByLabel('Name')).toHaveValue('shop-orders.csv');
  await dialog.getByLabel('Name').fill('Orders');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(node(page, 'Orders')).toBeVisible();
  await expect(node(page, 'shop-orders.csv')).toHaveCount(0);

  // A source renamed still says which file it reads, and its results take the new name.
  await selectNode(page, 'Orders');
  await expect(page.getByTestId('inspector-source')).toContainText('Source · CSV · shop-orders.csv');
  await expect(page.getByTestId('results-title')).toHaveText('Orders');

  // With F2 on the selected node.
  await page.keyboard.press('F2');
  await expect(dialog.getByLabel('Name')).toHaveValue('Orders');
  await dialog.getByLabel('Name').fill('Shop orders');
  await dialog.getByLabel('Name').press('Enter');
  await expect(node(page, 'Shop orders')).toBeVisible();

  // In the inspector, as every other node is renamed.
  const name = page.getByLabel('Node name');
  await expect(name).toHaveValue('Shop orders');
  await name.fill('All orders');
  await name.press('Enter');
  await expect(node(page, 'All orders')).toBeVisible();
});
