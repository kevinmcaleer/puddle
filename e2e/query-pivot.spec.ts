import { expect, test } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp, selectNode } from './helpers/app';

test('the Pivot view: fields from two related tables into Rows, Columns and Values give a pivot table', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-customers.csv'), fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });

  // A Join states how the two tables relate; the project's relationships carry that into any query of them.
  await selectNode(page, 'shop-customers.csv');
  await selectNode(page, 'shop-orders.csv', ['Shift']);
  await page.getByTestId('group-bar').getByRole('button', { name: 'Join these two' }).click();
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });

  await selectNode(page, 'shop-customers.csv');
  await selectNode(page, 'shop-orders.csv', ['Shift']);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Query/ }).click();
  const designer = page.getByTestId('query-designer');
  await expect(designer).toBeVisible();

  // The Pivot view lists both tables' fields, already joined: nothing warns of rows pairing with every row.
  await designer.getByRole('tab', { name: 'Pivot' }).click();
  const pivot = designer.getByTestId('query-pivot');
  await expect(pivot.getByRole('complementary', { name: 'Fields' })).toContainText('shop-customers.csv');
  await expect(pivot.getByRole('complementary', { name: 'Fields' })).toContainText('order_id');

  await pivot.getByLabel('Add a field to Rows').selectOption({ label: 'shop-customers.csv.name' });
  await pivot.getByLabel('Add a field to Values').selectOption({ label: 'shop-orders.csv.total' });
  await expect(designer.getByTestId('query-cross-join')).toHaveCount(0);
  // Rows and Values alone are a grouped query: a row per customer, the total summed.
  await expect(page.getByTestId('inspector-columns')).toHaveText(/name.*SumOftotal/s);
  await expectRows(page, 4);

  // A field in Columns: its values are read and each becomes a column of the sum.
  await pivot.getByLabel('Add a field to Columns').selectOption({ label: 'shop-orders.csv.status' });
  await expect(pivot.getByTestId('pivot-values-count')).toHaveText('2 values');
  await expect(page.getByTestId('inspector-columns').locator('.ui-col')).toHaveText(['name', 'pending', 'shipped']);
  await expectRows(page, 4);

  // A filter leaves rows out before anything is summed.
  await pivot.getByLabel('Add a field to Filters').selectOption({ label: 'shop-orders.csv.total' });
  await pivot.getByLabel('Condition on total').selectOption({ label: 'More than' });
  await pivot.getByLabel('Value for total').fill('5');
  await pivot.getByLabel('Value for total').press('Enter');
  await expectRows(page, 2);

  // It is the same design the grid shows: status is the Pivot columns field there.
  await designer.getByRole('tab', { name: 'Design' }).click();
  await expect(designer.getByLabel('Total for status')).toHaveValue('pivot');
  await expect(designer.getByLabel('Total for name')).toHaveValue('group');
});
