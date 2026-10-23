import { expect, test } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp, selectNode } from './helpers/app';

test('Fix all clears a source’s issues as a Fixes group in one undo step, and the dropdown applies a chosen subset', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('messy.csv')]);
  await expectRows(page, 5);
  await expect(node(page, 'messy.csv').getByTestId('node-issues')).toHaveText('7 issues', { timeout: 20_000 });

  // Over the results table: one click fixes every fix-level issue; the result is viewed, grouped as Fixes.
  await page.getByTestId('results-panel').getByRole('button', { name: 'Fix 7 issues' }).click();
  await expectRows(page, 4);
  await expect(page.getByTestId('strip-issues')).toHaveAttribute('data-count', '0', { timeout: 20_000 });
  await expect(page.getByText('Fixes', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Fix \d+ (of \d+ )?issues?$/ })).toHaveCount(0);

  // One undo step takes the whole lot back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expectRows(page, 5);
  await expect(page.getByText('Fixes', { exact: true })).toHaveCount(0);
  await expect(node(page, 'messy.csv').getByTestId('node-issues')).toHaveText('7 issues');

  // From the inspector: untick Trim in the dropdown and apply the rest. The spaces issues stay listed.
  await selectNode(page, 'messy.csv');
  const fixAll = page.getByTestId('inspector-source').getByTestId('fix-all');
  await fixAll.getByRole('button', { name: 'Choose fixes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose fixes' });
  await dialog.getByLabel('Spaces at either end of name').uncheck();
  await dialog.getByLabel('Spaces at either end of city').uncheck();
  await dialog.getByRole('button', { name: 'Apply 5 fixes' }).click();
  await expectRows(page, 4);
  await expect(page.getByTestId('strip-issues')).toHaveAttribute('data-count', '2', { timeout: 20_000 });
  await expect(page.getByTestId('issues').getByTestId('issue-edgeSpaces:name')).toBeVisible();
  await expect(page.getByTestId('issues').getByTestId('issue-edgeSpaces:city')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fix 2 issues' }).first()).toBeVisible();
});
