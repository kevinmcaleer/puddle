import { expect, test } from '@playwright/test';
import { addFiles, cell, expectRows, fixture, node, openApp } from './helpers/app';

test('a sheet whose rows shift a column part way down lists the skew as one issue, and Fix all moves the cells back', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('messy/skewed.xlsx')]);
  await expect(node(page, 'skewed.xlsx')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expectRows(page, 36);
  await node(page, 'skewed.xlsx').click();

  // From the 18th row a Customer cell was deleted, so the cells sit a column left: one issue, with Realign rows as its fix.
  const issues = page.getByTestId('issues');
  const skew = issues.getByTestId('issue-skewedRows:Customer:left');
  await expect(skew).toBeVisible({ timeout: 20_000 });
  await expect(skew).toHaveAttribute('data-severity', 'fix');
  await expect(skew).toContainText('Rows shifted one column left from Customer');
  await expect(skew).toContainText('Fix: Realign rows');

  // Realign rows is a step of its own on the Add menu, for a skew found by eye.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^Realign rows/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // Fix all: the moved cells go back, the dates and amounts get their types, and the issue is gone.
  await page.getByTestId('inspector-source').getByTestId('fix-all').getByRole('button', { name: /^Fix \d+ issues?$/ }).click();
  await expectRows(page, 36);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', 'Invoice,Customer,Issued,Due,Net,VAT,Gross', { timeout: 20_000 });
  await expect(cell(page, 1, 17)).toHaveText('');
  await expect(cell(page, 6, 17)).toHaveText(/^\d+(\.\d+)?$/);
  await expect(page.getByTestId('issues').getByTestId('issue-skewedRows:Customer:left')).toHaveCount(0, { timeout: 20_000 });
});
