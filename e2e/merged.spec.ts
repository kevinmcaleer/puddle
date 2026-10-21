import { expect, test } from '@playwright/test';
import { addFiles, cell, expectRows, fixture, node, openApp } from './helpers/app';

test('a report with merged cells opens as one table with its header rows joined and the regions filled, lists its totals and spacer column, and offers the footnotes as a table', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('messy/merged.xlsx')]);
  await expect(node(page, 'merged.xlsx')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expectRows(page, 16);
  await node(page, 'merged.xlsx').click();
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', 'Region,Store,Q1 Jan,Q1 Feb,Q1 Mar,Q2 Apr,Q2 May,Q2 Jun,Column I,Notes', { timeout: 20_000 });
  // The region merged down its stores is on each of them.
  await expect(cell(page, 0, 1)).toHaveText('North');
  await expect(cell(page, 1, 1)).toHaveText('Manchester');

  // The read options: the two tables on the sheet, the header rows detected, and merged cells filled.
  const panel = page.getByTestId('excel-panel');
  await expect(page.getByLabel('Table').locator('option')).toHaveText(['A4:J21 (18 rows, 10 columns)', 'A24:B28 (5 rows, 2 columns)']);
  await expect(page.getByLabel('Header rows')).toHaveAttribute('placeholder', 'Detect (2 rows)');
  await expect(panel.getByRole('switch', { name: 'Fill merged cells' })).toHaveAttribute('aria-checked', 'true');

  // The totals inside the data and the empty spacer column are issues; the totals, a suggestion, ticked in Choose fixes.
  const issues = page.getByTestId('issues');
  await expect(issues.getByTestId('issue-totalRows')).toBeVisible({ timeout: 20_000 });
  await expect(issues.getByTestId('issue-totalRows')).toHaveAttribute('data-severity', 'suggest');
  await expect(issues.getByTestId('issue-emptyColumn:Column I')).toHaveAttribute('data-severity', 'fix');
  const fixAll = page.getByTestId('inspector-source').getByTestId('fix-all');
  await fixAll.getByRole('button', { name: 'Choose fixes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose fixes' });
  await dialog.getByLabel('Total rows inside the data').check();
  await dialog.getByRole('button', { name: /^Apply \d+ fixes$/ }).click();
  await expectRows(page, 11);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', 'Region,Store,Q1 Jan,Q1 Feb,Q1 Mar,Q2 Apr,Q2 May,Q2 Jun,Notes', { timeout: 20_000 });

  // Back on the source, the footnotes table is added as a source of its own, reading the same file.
  await node(page, 'merged.xlsx').click();
  await page.getByTestId('excel-add-tables').click();
  await expect(node(page, 'merged.xlsx A24:B28')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, 'merged.xlsx A24:B28').click();
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', 'Code,Meaning', { timeout: 20_000 });
  await expectRows(page, 3);
  await expect(page.getByTestId('excel-add-tables')).toHaveCount(0);
});
