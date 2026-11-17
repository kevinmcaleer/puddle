import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addFiles, expectRows, fixture, node, openApp } from './helpers/app';

// #271: after Fix all nothing on screen offered to export; an Output node had to be added first.
test('a file is fixed and exported from the results bar, without adding an Output by hand', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('messy.csv')]);
  await expectRows(page, 5);
  const bar = page.getByTestId('results-panel');
  await bar.getByRole('button', { name: 'Fix 7 issues' }).click();
  await expectRows(page, 4);

  // Export is on the bar at the fixed rows. It adds the Output, shows it, and downloads a file named after the data.
  const download = page.waitForEvent('download');
  await bar.getByTestId('export-here').getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('messy-clean.csv');
  const lines = readFileSync(await file.path(), 'utf8').trim().split('\n');
  expect(lines).toHaveLength(5);
  await expect(page.getByTestId('canvas-notice')).toContainText('Exported messy-clean.csv (4 rows).');
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('results-title')).toHaveText('Output 1');
  await expect(bar.getByRole('button', { name: 'Export CSV' })).toBeVisible();

  // Adding the Output was one undo step.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(node(page, 'Output 1')).toHaveCount(0);
});

test('E, and the format menu, export any viewed node through one Output after it', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv')]);
  await expectRows(page, 5);
  let download = page.waitForEvent('download');
  await page.keyboard.press('e');
  expect((await download).suggestedFilename()).toBe('shop-orders.csv');
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok');

  // Back on the source, another format goes through the same Output rather than adding a second.
  await node(page, 'shop-orders.csv').click();
  await expect(page.getByTestId('results-title')).toHaveText('shop-orders.csv');
  download = page.waitForEvent('download');
  await page.getByTestId('export-here').getByTestId('export-formats').click();
  // Excel rather than Parquet: the dev server has no DuckDB extensions to write Parquet with.
  await page.getByRole('menuitemradio', { name: 'Excel' }).click();
  expect((await download).suggestedFilename()).toBe('shop-orders.xlsx');
  await expect(page.locator('[data-testid^="node-Output"]')).toHaveCount(1);
});
