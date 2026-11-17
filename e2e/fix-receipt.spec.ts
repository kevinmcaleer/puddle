import { expect, test } from '@playwright/test';
import { openApp } from './helpers/app';

test('Fix all ends on a receipt of what it fixed; a line opens its step, and the Fixes group leads back to it', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'All projects' }).click();
  await page.getByTestId('home-samples').getByTestId('sample-sales').click();
  const fixAll = page.getByTestId('results-panel').getByRole('button', { name: /^Fix \d+ (of \d+ )?issues?$/ });
  await expect(fixAll).toBeVisible({ timeout: 20_000 });
  await fixAll.click();

  const receipt = page.getByTestId('fix-receipt');
  await expect(receipt.getByTestId('receipt-title')).toHaveText('Fixed 7 issues');
  await expect(receipt).toContainText('In sales.csv, with 5 steps after it.');
  const lines = receipt.getByTestId('receipt-line');
  await expect(lines).toHaveCount(6);
  await expect(lines.nth(0)).toContainText('Read options');
  await expect(lines.nth(1)).toContainText('Trimmed currency, region');
  await expect(lines.nth(1)).toContainText('Spaces at either end of currency');
  await expect(lines.nth(1)).toContainText('16 rows');
  await expect(lines.nth(4)).toContainText('Numbers stored as text in amount');
  await expect(receipt.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();

  // A line opens its step: the receipt gives way to that Transform, and the results show the rows up to it.
  await lines.nth(4).getByRole('button', { name: 'Parsed numbers in amount' }).click();
  await expect(receipt).toHaveCount(0);
  await expect(page.getByTestId('inspector-transform')).toBeVisible();
  await expect(page.getByTestId('inspector-transform')).toContainText('Parsed numbers in amount');

  // The Fixes group leads back to the receipt.
  await page.getByTestId('group-Fixes').click({ button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'What this fixed' }).click();
  await expect(receipt.getByTestId('receipt-title')).toHaveText('Fixed 7 issues');
  await receipt.getByRole('button', { name: 'Done' }).click();
  await expect(receipt).toHaveCount(0);
});
