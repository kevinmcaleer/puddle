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

test('the receipt’s foot stays in view in a short window, the node’s badge says the same number, and the fixes are saved as a template', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await openApp(page);
  await page.getByTestId('welcome-samples').getByTestId('sample-sales').click();
  const fixAll = page.getByTestId('results-panel').getByRole('button', { name: /^Fix \d+ (of \d+ )?issues?$/ });
  await expect(fixAll).toBeVisible({ timeout: 20_000 });
  await fixAll.click();

  // Six lines don't fit a window this short: they scroll, and Export and Done stay where they are.
  const receipt = page.getByTestId('fix-receipt');
  await expect(receipt.getByTestId('receipt-title')).toHaveText('Fixed 7 issues');
  const foot = receipt.getByTestId('receipt-foot');
  await expect(foot.getByRole('button', { name: 'Export', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(foot.getByRole('button', { name: 'Done' })).toBeInViewport({ ratio: 1 });
  expect(await receipt.getByTestId('receipt-scroll').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await receipt.getByTestId('receipt-line').last().scrollIntoViewIfNeeded();
  await expect(foot.getByRole('button', { name: 'Done' })).toBeInViewport({ ratio: 1 });

  // The badge counts the issue the read options fixed too, so it agrees with the receipt.
  await expect(page.getByTestId('node-sales.csv').getByTestId('node-fixed')).toHaveText('7 fixed');

  // Save as template: named after the file, with the five fixing steps ticked.
  await foot.getByRole('button', { name: 'Save as template' }).click();
  const save = page.getByRole('dialog', { name: 'Save as template' });
  await expect(save.getByLabel('Name')).toHaveValue('sales fixes');
  await expect(save.getByRole('switch', { checked: true })).toHaveCount(5);
  await save.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByTestId('canvas-notice')).toContainText('Saved “sales fixes” as a template.');
});
