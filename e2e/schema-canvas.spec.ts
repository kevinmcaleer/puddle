import { expect, test } from '@playwright/test';
import { addFiles, fixture, node, openApp, selectNode } from './helpers/app';

test('a relationship drawn once shows in the Schema view with the canvas’s tables, and a new Query comes joined on it', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv'), fixture('shop-customers.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok');
  await expect(node(page, 'shop-customers.csv')).toHaveAttribute('data-status', 'ok');

  // Relate the order's customer to the customer, in the Relationships view.
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: /Relationships/ }).click();
  const rel = page.getByTestId('relationships');
  await rel.getByTestId('rel-field-shop-orders.csv-customer_id').dragTo(rel.getByTestId('rel-field-shop-customers.csv-customer_id'));
  await expect(rel.getByTestId('relationship')).toHaveCount(1);
  await rel.getByRole('button', { name: 'Back to canvas' }).click();

  // The Schema view documents both sources, with the relationship between them, though the DBML is empty.
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
  const schema = page.getByTestId('schema-view');
  await expect(schema.getByTestId('schema-canvas-counts')).toHaveText('2 from the canvas');
  await expect(schema.getByTestId('schema-group-Canvas tables')).toBeVisible();
  await expect(schema.getByTestId('schema-col-shop-orders.csv-customer_id')).toBeVisible();
  await expect(schema.getByTestId('schema-table-shop-customers.csv')).toContainText('name');
  await expect(schema.getByTestId('schema-ref-shop-orders.csv-shop-customers.csv')).toBeAttached();
  // Turned off, only the DBML's tables are left.
  await schema.getByRole('switch', { name: 'Canvas' }).click();
  await expect(schema.getByTestId('schema-table-shop-orders.csv')).toHaveCount(0);
  await schema.getByRole('switch', { name: 'Canvas' }).click();
  await expect(schema.getByTestId('schema-table-shop-orders.csv')).toBeVisible();
  await schema.getByRole('button', { name: 'Back to canvas' }).click();

  // A Query of the two tables starts joined on that relationship.
  await selectNode(page, 'shop-customers.csv');
  await selectNode(page, 'shop-orders.csv', ['Shift']);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Query/ }).click();
  const designer = page.getByTestId('query-designer');
  await expect(designer.getByTestId('query-join-line')).toHaveCount(1);
  await expect(designer.getByTestId('query-cross-join')).toHaveCount(0);
});
