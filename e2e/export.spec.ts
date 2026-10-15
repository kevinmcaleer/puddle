import { expect, test, type Page } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp } from './helpers/app';

const bar = (page: Page) => page.locator('.ui-resultsbar');
const log = (page: Page) => page.getByTestId('export-log');

async function customersToOutput(page: Page) {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok');
}

test('an Output node exports CSV through DuckDB and logs it', async ({ page }) => {
  await customersToOutput(page);
  await node(page, 'Output 1').click();
  await expectRows(page, 4);

  const download = page.waitForEvent('download');
  await bar(page).getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Output 1.csv');
  const text = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
  const lines = text.trim().split('\n');
  expect(lines[0]).toBe('id,name,email,joined');
  expect(lines).toHaveLength(5);
  await expect(page.getByTestId('canvas-notice')).toContainText('Exported Output 1.csv (4 rows).');
  await expect(log(page)).toContainText('Output 1.csv · 4 rows');


  await page.getByLabel('Format').selectOption('parquet');
  await expect(page.getByTestId('output-settings')).toContainText('Saved as Output 1.parquet.');
  await page.getByLabel('File name').fill('tidy');
  await page.getByLabel('File name').press('Enter');
  await expect(page.getByTestId('output-settings')).toContainText('Saved as tidy.parquet.');
  await expect(bar(page).getByRole('button', { name: 'Export Parquet' })).toBeEnabled();
});

test('a failing rule upstream blocks the export, which can be overridden and is logged', async ({ page }) => {
  await customersToOutput(page);
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('menuitem', { name: 'No leading or trailing spaces', exact: true }).click();
  await page.getByTestId('rule-settings').getByRole('button', { name: 'name', exact: true }).click();
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-rules', 'fail', { timeout: 20_000 });

  await expect(node(page, 'Output 1')).toHaveAttribute('data-export', 'blocked');
  await expect(node(page, 'Output 1')).toContainText('Export blocked');
  await node(page, 'Output 1').click();
  const blocked = bar(page).getByTestId('export-blocked');
  await expect(blocked).toContainText('Export blocked');
  await expect(blocked).toContainText('No leading or trailing spaces in name fails on 2 rows in customers.csv.');
  await expect(bar(page).getByRole('button', { name: 'Export CSV' })).toBeDisabled();

  await page.getByRole('button', { name: 'Export all' }).click();
  await expect(page.getByTestId('canvas-notice')).toContainText('Nothing exported. Skipped Output 1 is blocked by No leading or trailing spaces in name.');

  const download = page.waitForEvent('download');
  await blocked.getByRole('button', { name: 'Export anyway' }).click();
  expect((await download).suggestedFilename()).toBe('Output 1.csv');
  await expect(log(page)).toContainText('Exported anyway past No leading or trailing spaces in name (customers.csv)');

  // A warning doesn't block.
  await node(page, 'customers.csv').click();
  const ruleName = page.getByTestId('rules').getByRole('button', { name: 'No leading or trailing spaces in name' });
  if ((await ruleName.getAttribute('aria-pressed')) !== 'true') await ruleName.click();
  await page.getByTestId('rule-settings').getByLabel('Severity').selectOption('warn');
  await expect(node(page, 'Output 1')).toHaveAttribute('data-export', 'ready');
  const again = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all' }).click();
  expect((await again).suggestedFilename()).toBe('Output 1.csv');
  await expect(page.getByTestId('canvas-notice')).toContainText('Exported Output 1.csv.');
});

test('copy an Output node to the clipboard as tab-separated text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await customersToOutput(page);
  await node(page, 'Output 1').click();
  await page.getByLabel('Format').selectOption('clipboard');
  await bar(page).getByRole('button', { name: 'Copy to clipboard' }).click();
  await expect(page.getByTestId('canvas-notice')).toContainText('Copied 4 rows from Output 1.');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.split('\n')[0]).toBe('id\tname\temail\tjoined');
  await expect(log(page)).toContainText('Clipboard · 4 rows');
});
