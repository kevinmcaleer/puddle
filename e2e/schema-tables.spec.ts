import { expect, test } from '@playwright/test';
import { addFiles, expectRows, fixture, fixtureText, node, openApp } from './helpers/app';

test('a table designed in the schema becomes a node, refuses a load that breaks its key, and shows the rows it refuses', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
  await page.getByRole('combobox', { name: 'DBML' }).fill(fixtureText('dbml/tables.dbml'));
  await page.getByRole('button', { name: 'Back to canvas' }).click();

  // An unwired table node holds its records and example records.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /^orders/ }).click();
  await expect(node(page, 'orders')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(page.getByTestId('inspector-table')).toBeVisible();

  // Added after a source, the table loads it: customer 5 is in the file twice, so those rows are refused.
  await addFiles(page, [fixture('shop-customers.csv')]);
  await expect(node(page, 'shop-customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, 'shop-customers.csv').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /^customers/ }).click();
  await expect(node(page, 'customers')).toHaveAttribute('data-status', 'error', { timeout: 20_000 });
  const failures = page.getByTestId('table-failures');
  await expect(failures).toContainText('2 rows have a customer_id that is already in the table or repeated');
  await failures.getByRole('button', { name: 'Show failing rows' }).click();
  await expect(page.getByTestId('results-title')).toHaveText('customers · rows that can’t load');
  await expectRows(page, 2);
});
