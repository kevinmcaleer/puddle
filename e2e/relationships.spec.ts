import { expect, test } from '@playwright/test';
import { addFiles, fixture, node, openApp, selectNode } from './helpers/app';

test('the relationships view shows a join’s key between the tables, relates two columns by dragging, and downloads DBML', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv'), fixture('shop-customers.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok');
  await expect(node(page, 'shop-customers.csv')).toHaveAttribute('data-status', 'ok');
  await selectNode(page, 'shop-orders.csv');
  await selectNode(page, 'shop-customers.csv', ['Shift']);
  await page.getByTestId('group-bar').getByRole('button', { name: 'Join these two' }).click();
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'ok');

  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: /Relationships/ }).click();
  const view = page.getByTestId('relationships');
  await expect(view).toBeVisible();
  await expect(view.getByTestId('rel-table-shop-orders.csv')).toContainText('customer_id');
  await expect(view.getByTestId('rel-table-shop-customers.csv')).toContainText('name');

  // The Join's key, drawn as a line; customer 5 appears twice in customers, so many to many.
  await expect(view.getByTestId('relationship-line')).toHaveCount(1);
  const rows = view.getByTestId('relationship');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('shop-orders.csv.customer_id');
  await expect(rows.first()).toContainText('shop-customers.csv.customer_id');
  await expect(rows.first().getByTestId('relationship-cardinality')).toHaveText('many to many');
  await expect(rows.first().getByRole('button', { name: 'Join 1' })).toBeVisible();

  // Drag a column onto a column of the other table: a rule that relates them, drawn dashed.
  await view.getByTestId('rel-field-shop-orders.csv-status').dragTo(view.getByTestId('rel-field-shop-customers.csv-status'));
  await expect(view.getByTestId('relationship-line')).toHaveCount(2);
  await expect(view.locator('[data-testid="relationship-line"][data-check]')).toHaveCount(1);
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'shop-orders.csv.status' })).toContainText('Every status exists in shop-customers.csv.status');

  const download = page.waitForEvent('download');
  await view.getByRole('button', { name: 'Download DBML' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.dbml$/);
  const dbml = Buffer.concat(await (await file.createReadStream()).toArray()).toString('utf8');
  expect(dbml).toContain('Table "shop-orders.csv" {');
  expect(dbml).toContain('Ref: "shop-orders.csv"."customer_id" <> "shop-customers.csv"."customer_id" // Join 1');
  expect(dbml).toContain('Ref: "shop-orders.csv"."status" ');

  // The rule is the project's own: back on the canvas, the orders source carries it.
  await view.getByRole('button', { name: 'Back to canvas' }).click();
  await expect(page.getByTestId('relationships')).toHaveCount(0);
  await node(page, 'shop-orders.csv').click();
  await expect(page.getByTestId('inspector')).toContainText('Every status exists in shop-customers.csv.status');
});
