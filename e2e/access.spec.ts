import { expect, test, type Page } from '@playwright/test';
import { addFiles, cell, columnsOf, expectRows, fixture, node, openApp } from './helpers/app';

const columns = (page: Page) => page.getByTestId('inspector-columns').locator('.ui-col');
const types = (page: Page) => page.getByTestId('inspector-columns').locator('.ui-type');

test('an Access database loads a table with Access types, switches table, and adds its other tables as sources', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop.accdb')]);
  await expect(node(page, 'shop.accdb')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  expect(await columnsOf(page, 'shop.accdb')).toEqual(['CustomerID', 'Name', 'Email', 'Joined', 'Active', 'CreditLimit']);
  expect(await types(page).evaluateAll((els) => els.map((e) => e.getAttribute('title')))).toEqual(['INTEGER', 'VARCHAR', 'VARCHAR', 'TIMESTAMP', 'BOOLEAN', 'DOUBLE']);
  await expectRows(page, 3);
  await expect(cell(page, 1, 2)).toHaveText('Zoë Café');
  await expect(cell(page, 5, 1)).toHaveText('250.5000');

  await expect(page.getByTestId('inspector-source')).toContainText('Source · Access');
  await expect(page.getByLabel('Table').locator('option')).toHaveText(['Customers (3 rows, 6 columns)', 'Orders (4 rows, 10 columns)', 'Archive (0 rows, 2 columns)']);
  await page.getByLabel('Table').selectOption('Orders');
  await expect(columns(page)).toHaveText(['OrderID', 'CustomerID', 'OrderDate', 'Quantity', 'Weight', 'Discount', 'Priority', 'Amount', 'Notes', 'Shipped']);
  await expectRows(page, 4);

  await page.getByTestId('access-add-tables').click();
  await expect(node(page, 'Customers')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'Archive')).toHaveAttribute('data-status', 'ok');
  // Every table is in the project now, so there is nothing left to add.
  await expect(page.getByTestId('access-add-tables')).toHaveCount(0);
});

test('a database encrypted with a password says it can’t be opened', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('locked.accdb')]);
  await expect(node(page, 'locked.accdb')).toHaveAttribute('data-access', 'failed', { timeout: 20_000 });
  await expect(page.getByTestId('results-access')).toContainText('This database is encrypted with a password, which Puddle can’t open.');
});
