import { expect, test } from '@playwright/test';
import { expectRows, node, openApp, selectNode } from './helpers/app';

// The Orders and customers sample: ids that differ by a trailing space ("C004 ") or by case ("c017").
test('a join says how many rows found no match, tidies its keys to match more, and shows the rest', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'All projects' }).click();
  await page.getByTestId('home-samples').getByTestId('sample-orders').click();
  await expect(node(page, 'orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');

  await selectNode(page, 'orders.csv');
  await selectNode(page, 'customers.csv', ['Shift']);
  await page.getByTestId('group-bar').getByRole('button', { name: 'Join these two' }).click();
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'ok');

  // Fewer than half the orders find their customer, and the join says so, with what would help.
  await expect(page.getByTestId('join-match')).toHaveText('28 of 60 left rows matched (47%). 13 of 20 right rows matched (65%).');
  const unmatched = page.getByTestId('join-unmatched');
  await expect(unmatched).toContainText('32 left rows found no match');
  await expect(page.getByTestId('join-cure')).toContainText('Trimming the spaces and using capitals in customer_id on both sides would match 30 more rows.');

  // The cure is a Transform on each wire into the join; the join stays selected and now matches all but two.
  await unmatched.getByRole('button', { name: 'Tidy the keys' }).click();
  await expect(page.getByTestId('join-match')).toContainText('58 of 60 left rows matched (97%)');
  await expect(unmatched).toContainText('2 left rows found no match');
  await expect(page.getByTestId('join-cure')).not.toBeAttached();
  await expect(node(page, 'Transform 1')).toContainText('Transform · 2 steps');
  await expect(node(page, 'Transform 2')).toContainText('Transform · 2 steps');

  // Show them: the two orders whose customer isn't in the list, as an anti join beside this one.
  await unmatched.getByRole('button', { name: 'Show them' }).click();
  await expect(page.getByTestId('results-title')).toHaveText('Join 1 unmatched');
  await expectRows(page, 2);

  // One undo takes the unmatched join away, the next the tidying.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(node(page, 'Join 1 unmatched')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(node(page, 'Transform 1')).toHaveCount(0);
});
