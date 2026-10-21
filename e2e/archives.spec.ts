import { expect, test } from '@playwright/test';
import { addFiles, columnsOf, expectRows, fixture, node, openApp } from './helpers/app';

test('a zip opens to the file inside, lists the others and adds them as sources; a .csv.gz and an Arrow file read as what they hold', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('archives/shop.zip')]);
  await expect(node(page, 'orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'orders.csv')).toContainText('Source · CSV in zip');
  expect(await columnsOf(page, 'orders.csv')).toEqual(['order_id', 'customer_id', 'total', 'status']);
  await expectRows(page, 5);
  await expect(page.getByTestId('archive-panel')).toHaveAttribute('data-kind', 'zip');
  // The junk a Mac zip carries is listed, but never offered to add.
  await expect(page.getByLabel('File inside').locator('option')).toHaveText([/^shop\/orders\.csv \(\d+ KB\)$/, /^shop\/customers\.csv/, /^__MACOSX/, /^shop\/\.DS_Store/]);
  await page.getByTestId('archive-add-entries').click();
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  expect(await columnsOf(page, 'customers.csv')).toEqual(['customer_id', 'name', 'status']);
  await expect(page.getByTestId('archive-add-entries')).toHaveCount(0);

  await addFiles(page, [fixture('archives/orders.csv.gz')]);
  await expect(node(page, 'orders.csv').nth(1)).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'orders.csv').nth(1)).toContainText('Source · CSV in gzip');

  await addFiles(page, [fixture('archives/customers.arrow')]);
  await expect(node(page, 'customers.arrow')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'customers.arrow')).toContainText('Source · Arrow');
  expect(await columnsOf(page, 'customers.arrow')).toEqual(['id', 'name', 'joined', 'balance', 'active']);
  await expectRows(page, 4);
});
