import { expect, test } from '@playwright/test';
import { addFiles, fixture, node, openApp, selectNode } from './helpers/app';

// #292: on a source the Issues list sat below its name, description and ten read options, under the fold.
test('on a source the issues come first, in view without scrolling, with the read options an issue needs open below them', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('welcome-samples').getByTestId('sample-sales').click();
  await expect(node(page, 'sales.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await selectNode(page, 'sales.csv');

  const issues = page.getByTestId('issues');
  await expect(issues).toHaveAttribute('data-state', 'ok', { timeout: 20_000 });
  await expect(issues.locator('[data-testid^="issue-"]').first()).toBeInViewport({ ratio: 1 });
  // Issues are above the node's name and its read options.
  const top = async (testId: string) => (await page.getByTestId(testId).boundingBox())!.y;
  expect(await top('issues-section')).toBeLessThan((await page.getByLabel('Node name').boundingBox())!.y);
  expect(await top('issues-section')).toBeLessThan(await top('read-options-toggle'));

  // One of its issues ("n/a" read as empty) is fixed by a read option, so the read options are open, below the issues.
  await expect(issues.locator('[data-testid^="issue-"]').filter({ hasText: 'as empty' }).first()).toBeVisible();
  const toggle = page.getByTestId('read-options-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Delimiter')).toBeVisible();
});

test('a file that reads cleanly keeps its read options folded, and they open and close by hand', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await selectNode(page, 'customers.csv');
  await expect(page.getByTestId('issues')).toHaveAttribute('data-state', 'ok', { timeout: 20_000 });
  const toggle = page.getByTestId('read-options-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('read-options-summary')).toHaveText('Read as CSV. Show the options to change how the file is read.');
  await expect(page.getByLabel('Delimiter')).toBeHidden();
  await toggle.click();
  await expect(page.getByLabel('Delimiter')).toBeVisible();
  await toggle.click();
  await expect(page.getByLabel('Delimiter')).toBeHidden();
});
