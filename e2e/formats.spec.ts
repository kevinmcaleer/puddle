import { expect, test } from '@playwright/test';
import { addFiles, columnsOf, expectRows, fixture, node, openApp } from './helpers/app';

test('an old .xls workbook opens like a .xlsx, named for its format, with its sheets listed; a dBase table opens with its fields', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('formats/sales.xls')]);
  await expect(node(page, 'sales.xls')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'sales.xls')).toContainText('Source · Excel 97-2003');
  await expectRows(page, 4);
  expect(await columnsOf(page, 'sales.xls')).toEqual(['Region', 'Order date', 'Amount', 'Paid', 'Notes', 'Contact', 'Contact_2', 'Column H']);
  await expect(page.getByTestId('inspector-source')).toContainText('Source · Excel 97-2003');
  // The old format records a used range even on the empty sheet, so that one is listed as a cell.
  await expect(page.getByLabel('Sheet').locator('option')).toHaveText(['Sales (7 rows, 8 columns)', 'Visits (3 rows, 4 columns)', 'Empty (1 row, 1 column)']);
  await page.getByLabel('Sheet').selectOption('Visits');
  await expectRows(page, 2);

  await addFiles(page, [fixture('formats/sales.dbf')]);
  await expect(node(page, 'sales.dbf')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'sales.dbf')).toContainText('Source · dBase');
  expect(await columnsOf(page, 'sales.dbf')).toEqual(['Region', 'Order date', 'Amount', 'Paid', 'Notes']);
  await expectRows(page, 4);
});
