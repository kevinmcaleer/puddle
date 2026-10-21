import { expect, test } from '@playwright/test';
import { addFiles, columnsOf, expectRows, fixture, node, openApp } from './helpers/app';

test('a Word document opens to its biggest table, the Table picker switches to another, and the rest are added as sources', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('word/report.docx')]);
  await expect(node(page, 'report.docx')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'report.docx')).toContainText('Source · Word');
  expect(await columnsOf(page, 'report.docx')).toEqual(['Name', 'Role & team', 'Role & team 2', 'Started']);
  await expectRows(page, 3);
  await expect(page.getByLabel('Table', { exact: true }).locator('option')).toHaveText(['Sales by region (5 rows, 3 columns)', 'Figures are in thousands. (1 row, 1 column)', 'Table 2: Staff at the end of June (4 rows, 4 columns)']);
  await page.getByLabel('Table', { exact: true }).selectOption('1');
  await expectRows(page, 4);
  expect(await columnsOf(page, 'report.docx')).toEqual(['Region', 'Quarter', 'Amount']);

  await page.getByTestId('word-add-tables').click();
  await expect(node(page, 'Figures are in thousands.')).toBeVisible();
  await expect(node(page, 'Table 2: Staff at the end of June')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
});
