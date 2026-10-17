import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addFiles, expectRows, fixture, node, openApp } from './helpers/app';

/** Set the project's "Sample above" threshold (shown when no node is selected). */
async function setThreshold(page: Page, rows: number) {
  await page.getByTestId('canvas').click({ position: { x: 600, y: 40 } });
  const input = page.getByLabel('Sample above');
  await input.fill(String(rows));
  await input.press('Enter');
}

const strip = (page: Page) => page.locator('.ui-strip');

test('a source over the threshold opens in sample mode, says so, and Run on full data gives the full counts', async ({ page }) => {
  await openApp(page);
  await setThreshold(page, 2);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');

  const banner = page.getByTestId('sample-banner');
  await expect(banner).toContainText('Sample of 2 rows');
  await expect(banner).toContainText('customers.csv has 4 rows');
  await expect(banner).toContainText('Exports always use the full data.');
  await expectRows(page, 2);
  await expect(strip(page)).toContainText('Sample of 2 rows');

  // Rules in sample mode say so.
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('menuitem', { name: 'Never empty', exact: true }).click();
  await page.getByTestId('rule-settings').getByRole('button', { name: 'email', exact: true }).click();
  await expect(page.getByTestId('rules').locator('.ui-rule').first()).toContainText('2 checked');
  await expect(page.getByTestId('rules-sample-note')).toBeVisible();
  await expect(page.getByTestId('rules-on-sample')).toHaveText('Rules checked on the sample');

  await banner.getByRole('button', { name: 'Run on full data' }).click();
  await expectRows(page, 4);
  await expect(page.getByTestId('sample-banner')).toHaveCount(0);
  await expect(strip(page)).toContainText('Full data');
  await expect(page.getByTestId('rules').locator('.ui-rule').first()).toContainText('1 of 4');
  await expect(page.getByTestId('rules-sample-note')).toHaveCount(0);

  await page.getByTestId('full-data-banner').getByRole('button', { name: 'Back to the sample' }).click();
  await expectRows(page, 2);
  await expect(page.getByTestId('sample-banner')).toBeVisible();
});

test('exports in sample mode check rules and write every row from the full data', async ({ page }) => {
  await openApp(page);
  await setThreshold(page, 2);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await node(page, 'Output 1').click();
  await expect(page.getByTestId('sample-banner')).toBeVisible();
  await expectRows(page, 2);

  const download = page.waitForEvent('download');
  await page.locator('.ui-resultsbar').getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  const lines = readFileSync(await file.path(), 'utf8').trim().split('\n');
  expect(lines).toHaveLength(5);
  await expect(page.getByTestId('export-log')).toContainText('Output 1.csv · 4 rows');
});

test('Stop cancels a slow query in DuckDB and the app stays usable', async ({ page }) => {
  await openApp(page);
  // A deliberately heavy query, as a long row count on a huge file would be.
  await page.evaluate(() => {
    const engine = (globalThis as unknown as { __puddle: { engine: { query(sql: string, o: object): Promise<unknown> } } }).__puddle.engine;
    const w = window as unknown as { slow: Promise<string> };
    w.slow = engine.query('SELECT count(*) FROM range(100000000000) t(i) WHERE i % 7 = 3', { label: 'Counting rows', priority: 'background' }).then(
      () => 'finished',
      (e: { code?: string }) => e.code ?? 'failed',
    );
  });
  const activity = page.getByTestId('activity');
  await expect(activity).toContainText('Counting rows');
  const t0 = Date.now();
  await activity.getByRole('button', { name: 'Stop' }).click();
  expect(await page.evaluate(() => (window as unknown as { slow: Promise<string> }).slow)).toBe('stopped');
  expect(Date.now() - t0).toBeLessThan(10_000);
  await expect(activity).toHaveCount(0);

  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  await expectRows(page, 4);
});

test('a stopped preview says so and runs again', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('semicolon.csv')]);
  await expectRows(page, 3);
  // Hold the engine with a heavy query, change a read option so the node's new columns queue behind it, then Stop.
  await page.evaluate(() => {
    const engine = (globalThis as unknown as { __puddle: { engine: { query(sql: string, o: object): Promise<unknown> } } }).__puddle.engine;
    void engine.query('SELECT count(*) FROM range(100000000000) t(i) WHERE i % 7 = 3', { label: 'Heavy' }).catch(() => undefined);
  });
  await expect(page.getByTestId('activity')).toContainText('Heavy');
  await page.getByLabel('Delimiter').selectOption({ label: 'Comma' });
  await page.getByTestId('activity').getByRole('button', { name: 'Stop' }).click();
  const stopped = page.getByTestId('results-stopped');
  await expect(stopped).toContainText('Stopped');
  await expect(node(page, 'semicolon.csv')).toContainText('Stopped before it finished.');
  await stopped.getByRole('button', { name: 'Run again' }).click();
  await expect(node(page, 'semicolon.csv')).toHaveAttribute('data-status', 'ok');
  await expectRows(page, 3);
  await expect(page.getByTestId('inspector-columns').locator('.ui-col')).toHaveText(['id;city']);
});

test('a stopped export saves nothing and is logged as stopped', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await node(page, 'Output 1').click();
  await expectRows(page, 4);
  let downloads = 0;
  page.on('download', () => downloads++);
  // Hold the engine so the export queues behind a heavy query, then Stop it from the export button.
  await page.evaluate(() => {
    const engine = (globalThis as unknown as { __puddle: { engine: { query(sql: string, o: object): Promise<unknown> } } }).__puddle.engine;
    void engine.query('SELECT count(*) FROM range(100000000000) t(i) WHERE i % 7 = 3', { label: 'Heavy' }).catch(() => undefined);
  });
  const bar = page.locator('.ui-resultsbar');
  await bar.getByRole('button', { name: 'Export CSV' }).click();
  await expect(bar.getByRole('button', { name: /^Exporting/ })).toBeVisible();
  await bar.getByTestId('export-stop').click();
  await expect(page.getByTestId('export-log')).toContainText('Output 1.csv · stopped, nothing saved');
  await expect(bar.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  expect(downloads).toBe(0);
});
