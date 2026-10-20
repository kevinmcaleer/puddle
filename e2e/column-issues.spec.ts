import { expect, test } from '@playwright/test';
import { expectRows, node, openApp } from './helpers/app';

test('a likely misspelling is listed with its fix; ticked in Choose fixes and applied with the rest, it is put right', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Try a sample' }).click();
  await page.getByRole('dialog', { name: 'Try a sample' }).getByTestId('sample-crm').click();
  await expect(node(page, 'messy.txt')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expectRows(page, 45);

  // The Issues panel lists the misspelt city as a suggestion, with the common spelling and Replace values as its fix.
  await node(page, 'messy.txt').click();
  const issues = page.getByTestId('issues');
  const typo = issues.getByTestId('issue-nearDuplicate:City:Manchestr');
  await expect(typo).toBeVisible({ timeout: 20_000 });
  await expect(typo).toContainText('Manchestr in City, probably Manchester');
  await expect(typo).toContainText('Fix: Replace values');
  await expect(typo).toHaveAttribute('data-severity', 'suggest');
  // The placeholders for empty are a read option; the balance and the sign-up date are whole columns to parse.
  await expect(issues.getByTestId('issue-placeholders:Status')).toContainText('Fix: Read "-", "?", "N/A", "NULL", "n/a" as empty');
  await expect(issues.getByTestId('issue-numbersAsText:Balance')).toHaveAttribute('data-severity', 'fix');
  await expect(issues.getByTestId('issue-datesAsText:Signed up')).toHaveAttribute('data-severity', 'fix');

  // In Choose fixes the suggestion starts unticked; tick it and apply with the rest.
  const fixAll = page.getByTestId('inspector-source').getByTestId('fix-all');
  await fixAll.getByRole('button', { name: 'Choose fixes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose fixes' });
  const tick = dialog.getByLabel('Manchestr in City, probably Manchester');
  await expect(tick).not.toBeChecked();
  await tick.check();
  await dialog.getByRole('button', { name: /^Apply \d+ fixes$/ }).click();
  await expectRows(page, 40);
  await expect(page.getByText('Fixes', { exact: true })).toBeVisible();
  // The result is viewed: no misspelling left, the balance a number.
  await expect(page.getByTestId('issues').getByTestId('issue-nearDuplicate:City:Manchestr')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('issues')).toHaveAttribute('data-state', 'ok');
  await expect(page.getByText('Replaced "Manchestr" with "Manchester" in City')).toBeVisible();
});
