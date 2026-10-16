import { expect, test } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp } from './helpers/app';

// Firefox and Safari can't keep access to files between visits (no showOpenFilePicker). openApp removes the
// picker, so in every browser these tests run as Firefox and Safari always do.

test('without file handles, a reopened project says plainly to choose its files again', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  // Nothing to choose again yet.
  await expect(page.getByTestId('files-not-kept-banner')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'detached');
  const banner = page.getByTestId('files-not-kept-banner');
  await expect(banner).toContainText('Files aren’t kept in this browser');
  await expect(banner).toContainText('choose customers.csv again from its node');
  // The one-click reconnect is for browsers that keep handles; it isn't offered here.
  await expect(page.getByTestId('reconnect-banner')).toHaveCount(0);

  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('results-detached').getByRole('button', { name: 'Choose file' }).click();
  await (await chooser).setFiles(fixture('customers.csv'));
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(banner).toHaveCount(0);
  await node(page, 'customers.csv').click();
  await expectRows(page, 4);
});

test('the note about files not being kept can be dismissed', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv'), fixture('orders.tsv')]);
  await expect(node(page, 'orders.tsv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  const banner = page.getByTestId('files-not-kept-banner');
  await expect(banner).toContainText(/choose (customers\.csv and orders\.tsv|orders\.tsv and customers\.csv) again from their nodes/);
  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toHaveCount(0);
  await expect(node(page, 'orders.tsv')).toHaveAttribute('data-status', 'detached');
});
