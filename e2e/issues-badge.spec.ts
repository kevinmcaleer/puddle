import { expect, test } from '@playwright/test';
import { node, openApp } from './helpers/app';

test('the issues badge lists every issue it counts, and Fix all counts out of the same number', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Try a sample' }).click();
  await page.getByRole('dialog', { name: 'Try a sample' }).getByTestId('sample-crm').click();
  const badge = node(page, 'messy.txt').getByTestId('node-issues');
  await expect(badge).toHaveText(/^\d+ issues$/, { timeout: 20_000 });
  const total = Number((await badge.textContent())!.split(' ')[0]);

  // Some of them are suggestions, so the button fixes fewer than the badge counts, and says so.
  await expect(page.getByTestId('results-panel').getByTestId('fix-all').getByRole('button', { name: new RegExp(`^Fix \\d+ of ${total} issues$`) })).toBeVisible();

  // Clicking the badge opens the node's Issues list in the inspector, scrolled into view, one row per issue counted.
  await page.getByTestId('inspector-tabs').getByRole('tab', { name: 'Project' }).click();
  await badge.getByRole('button', { name: `${total} issues` }).click();
  await expect(page.getByTestId('inspector-tabs').getByRole('tab', { name: 'Node' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('issues-section')).toBeInViewport();
  await expect(page.getByTestId('issues').locator('[data-testid^="issue-"][data-severity]')).toHaveCount(total);

  // The status strip's badge does the same.
  await page.getByTestId('inspector-tabs').getByRole('tab', { name: 'Project' }).click();
  await page.getByTestId('strip-issues').getByRole('button', { name: `${total} issues` }).click();
  await expect(page.getByTestId('issues-section')).toBeInViewport();
});
