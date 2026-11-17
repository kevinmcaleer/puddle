import { expect, test } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp, selectNode } from './helpers/app';

test('queries are listed in the project panel, read tables by name, and stay off the canvas', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-customers.csv'), fixture('shop-orders.csv')]);
  for (const name of ['shop-customers.csv', 'shop-orders.csv']) await expect(node(page, name)).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });

  // The panel is out of the way until a query needs it; its button brings it in, listing the tables.
  await expect(page.getByTestId('project-panel')).toHaveCount(0);
  await page.getByTestId('outline-toggle').click();
  const panel = page.getByTestId('project-panel');
  await expect(panel.getByRole('region', { name: 'Tables' }).getByRole('button')).toHaveText([/shop-customers\.csv/, /shop-orders\.csv/]);

  // A new query reads the selected table by name, and asks for a name of its own.
  await selectNode(page, 'shop-orders.csv');
  await panel.getByRole('button', { name: 'New query' }).click();
  const naming = page.getByRole('dialog', { name: 'Rename node' });
  await naming.getByLabel('Name').fill('Orders per customer');
  await naming.getByRole('button', { name: 'Rename' }).click();
  const row = panel.getByTestId('outline-Orders per customer');
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(row).toContainText('reads shop-orders.csv');
  await expect(row).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });

  // It is in the list only: no card and no wire on the canvas, and the table says it is read.
  await expect(node(page, 'Orders per customer')).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(node(page, 'shop-orders.csv').getByTestId('read-by')).toHaveText('Read by 1 query');

  // Naming another table in the SQL is enough to read it: no wire is drawn by hand.
  const query = page.getByLabel('SQL query');
  await query.fill('SELECT c.customer_id, count(*) AS orders\nFROM "shop-orders.csv" o JOIN "shop-customers.csv" c USING (customer_id)\nGROUP BY 1');
  await query.press('Control+Enter');
  await expect(row).toContainText('reads shop-orders.csv, shop-customers.csv');
  await expect(row).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(page.getByTestId('results-title')).toHaveText('Orders per customer');
  await expect(node(page, 'shop-customers.csv').getByTestId('read-by')).toHaveText('Read by 1 query');

  // The mark on a table leads back to the query after looking elsewhere.
  await selectNode(page, 'shop-customers.csv');
  await expect(row).not.toHaveAttribute('aria-current', 'true');
  await node(page, 'shop-customers.csv').getByTestId('read-by').click();
  await expect(row).toHaveAttribute('aria-current', 'true');

  // The project setting puts queries back on the canvas, wired as any node.
  await page.getByRole('tab', { name: 'Project' }).click();
  await page.getByRole('switch', { name: 'Keep queries in the project panel' }).click();
  await expect(node(page, 'Orders per customer')).toBeVisible();
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await expect(page.getByTestId('read-by')).toHaveCount(0);
  await panel.getByTestId('move-queries').click();
  await expect(node(page, 'Orders per customer')).toHaveCount(0);
});
