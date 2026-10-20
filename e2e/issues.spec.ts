import { expect, test } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp, selectNode } from './helpers/app';

test('a source shows the issues analysis found, on its card, in the strip and in the inspector; one can be ignored and brought back', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('messy.csv')]);
  await expectRows(page, 5);

  // The node card and the status strip carry the count.
  await expect(node(page, 'messy.csv').getByTestId('node-issues')).toHaveText('6 issues', { timeout: 20_000 });
  await expect(page.getByTestId('strip-issues')).toHaveAttribute('data-count', '6');

  // The inspector lists each with its count, examples and fix.
  await selectNode(page, 'messy.csv');
  const issues = page.getByTestId('issues');
  await expect(issues).toHaveAttribute('data-state', 'ok');
  await expect(issues.getByTestId('issue-duplicateRows')).toContainText('Duplicate rows');
  const spaces = issues.getByTestId('issue-edgeSpaces:name');
  await expect(spaces).toContainText('Spaces at either end of name');
  await expect(spaces).toContainText('2 of 5');
  await expect(spaces).toContainText('Fix: Trim whitespace');
  await expect(spaces.locator('code')).toContainText('ada   lovelace');
  await expect(issues.getByTestId('issue-nonPrinting:name')).toContainText('Non-printing characters in name');

  // Ignore one: the count drops everywhere, undo brings it back, and Show ignored does too. (It is kept in the
  // project, so it survives a reload; the model test covers that.)
  await spaces.getByRole('button', { name: 'Ignore issue: Spaces at either end of name' }).click();
  await expect(spaces).toHaveCount(0);
  await expect(issues.getByTestId('issues-ignored')).toContainText('1 issue ignored');
  await expect(page.getByTestId('strip-issues')).toHaveAttribute('data-count', '5');
  await expect(node(page, 'messy.csv').getByTestId('node-issues')).toHaveText('5 issues');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(spaces).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(spaces).toHaveCount(0);
  await page.getByRole('button', { name: 'Show ignored' }).click();
  await expect(page.getByTestId('issue-edgeSpaces:name')).toBeVisible();
  await expect(page.getByTestId('strip-issues')).toHaveAttribute('data-count', '6');
});
