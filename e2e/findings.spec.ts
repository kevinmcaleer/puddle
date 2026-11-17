import { expect, test } from '@playwright/test';
import { node, openApp, saved } from './helpers/app';

// #296: when a file loaded, what Puddle found was a small badge on the node and a quiet button on the results bar.
test('the first result leads with what was found: Show me opens the Issues list, and Fix all clears it', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('welcome-samples').getByTestId('sample-sales').click();
  await expect(node(page, 'sales.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });

  const headline = page.getByTestId('findings-headline');
  await expect(headline.getByTestId('findings-title')).toHaveText(/^\d+ problems found in sales\.csv$/, { timeout: 20_000 });
  // The number is the one Fix all would fix: the button beside it says the same.
  const count = Number((await headline.getByTestId('findings-title').textContent())!.split(' ')[0]);
  await expect(headline.getByTestId('fix-all').getByRole('button', { name: new RegExp(`^Fix ${count} (of \\d+ )?issues?$`) })).toBeVisible();
  // One Fix all over the results, not two.
  await expect(page.getByTestId('results-panel').getByTestId('fix-all')).toHaveCount(1);

  // Show me selects the source and brings its Issues list into view.
  await page.getByTestId('canvas').click({ position: { x: 20, y: 20 } });
  await headline.getByRole('button', { name: 'Show me' }).click();
  await expect(page.getByTestId('inspector-source').getByTestId('issues').locator('[data-testid^="issue-"]').first()).toBeInViewport();

  // Fix all fixes them, and the headline goes: the fixed source has nothing left to announce.
  await headline.getByTestId('fix-all').getByRole('button', { name: /^Fix \d+ (of \d+ )?issues?$/ }).click();
  await expect(page.getByTestId('fix-receipt')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('fix-receipt').getByRole('button', { name: 'Done' }).click();
  await page.getByTestId('node-sales.csv').click();
  await expect(page.getByTestId('results-title')).toHaveText('sales.csv');
  await expect(headline).toHaveCount(0);
});

test('a dismissed headline stays dismissed for that source, and its issues stay on the Issues list', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('welcome-samples').getByTestId('sample-sales').click();
  await expect(node(page, 'sales.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  const headline = page.getByTestId('findings-headline');
  await expect(headline).toBeVisible({ timeout: 20_000 });
  await headline.getByRole('button', { name: 'Dismiss' }).click();
  await expect(headline).toHaveCount(0);
  // The results bar has its own Fix all again.
  await expect(page.getByTestId('results-panel').getByTestId('fix-all')).toHaveCount(1);
  // Kept with the project, so it survives a reload.
  await expect.poll(async () => ((await saved(page))?.nodes[0] as { findingsDismissed?: boolean } | undefined)?.findingsDismissed).toBe(true);
  await page.reload();
  await expect(node(page, 'sales.csv')).toHaveAttribute('data-status', 'ok', { timeout: 45_000 });
  await expect(page.getByTestId('results-panel').getByTestId('fix-all')).toBeVisible({ timeout: 20_000 });
  await expect(headline).toHaveCount(0);
});
