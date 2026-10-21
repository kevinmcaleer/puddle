import { expect, test } from '@playwright/test';
import { addFiles, columnsOf, expectRows, fixture, node, openApp } from './helpers/app';

test('a text PDF opens to its biggest table, the Table picker switches to the other, and a scan says it has no text', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('pdf/statement.pdf')]);
  await expect(node(page, 'statement.pdf')).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });
  await expect(node(page, 'statement.pdf')).toContainText('Source · PDF');
  expect(await columnsOf(page, 'statement.pdf')).toEqual(['Date', 'Description', 'Paid in', 'Paid out']);
  await expectRows(page, 4);
  await expect(page.getByLabel('Table', { exact: true }).locator('option')).toHaveText(['Transactions (page 1) (5 rows, 4 columns)', 'Summary (page 2) (3 rows, 2 columns)']);
  await page.getByLabel('Table', { exact: true }).selectOption('2');
  await expectRows(page, 2);
  expect(await columnsOf(page, 'statement.pdf')).toEqual(['Item', 'Amount']);

  await addFiles(page, [fixture('pdf/scan.pdf')]);
  await expect(page.getByTestId('results-rewrite')).toContainText('This PDF has no text to read', { timeout: 30_000 });
});
