import { expect, test } from '@playwright/test';
import { expectRows, node, openApp, selectNode } from './helpers/app';

test('the CRM export sample opens with its comment lines and footer skipped, and Fix all leaves the clean table', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Try a sample' }).click();
  await page.getByRole('dialog', { name: 'Try a sample' }).getByTestId('sample-crm').click();
  await expect(page.getByTestId('project-name')).toHaveText('Sample: CRM export');
  await expect(node(page, 'messy.txt')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  // 44 customers and the header pasted in again; the two comment lines and the row count never reach the table.
  await expectRows(page, 45);

  // The read options the sniff chose show in the inspector.
  await selectNode(page, 'messy.txt');
  await expect(page.getByLabel('Delimiter')).toHaveValue(';');
  await expect(page.getByLabel('Skip lines at the top')).toHaveValue('2');
  await expect(page.getByLabel('Skip rows at the bottom')).toHaveValue('1');

  // Fix all drops the repeated header and the duplicates and tidies the text in one go.
  await expect(page.getByTestId('issues').getByTestId('issue-repeatedHeader')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('results-panel').getByRole('button', { name: /^Fix \d+ (of \d+ )?issues$/ }).click();
  await expectRows(page, 40);
  await expect(page.getByText('Fixes', { exact: true })).toBeVisible();
});
