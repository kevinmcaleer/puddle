import { expect, test, type Page } from '@playwright/test';
import { addFiles, fixture, node, openApp } from './helpers/app';

type Engine = { query(sql: string): Promise<{ table: { toArray(): Array<{ toJSON(): Record<string, unknown> }> } }> };

/** Row count of the one kept table, read through the page's engine. */
const keptRows = (page: Page) =>
  page.evaluate(async () => {
    const engine = (globalThis as unknown as { __puddle: { engine: Engine } }).__puddle.engine;
    const names = (await engine.query(`SELECT table_name FROM duckdb_tables() WHERE table_name LIKE 'kept_%'`)).table.toArray().map((r) => String(r.toJSON().table_name));
    if (names.length !== 1) return null;
    return Number((await engine.query(`SELECT count(*) AS n FROM "${names[0]}"`)).table.toArray()[0]!.toJSON().n);
  });

test('in sample mode a kept result holds the sample, shows as up to date, and Run on full data rebuilds it', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('canvas').click({ position: { x: 600, y: 40 } });
  await page.getByLabel('Sample above').fill('2');
  await page.getByLabel('Sample above').press('Enter');
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(page.getByTestId('sample-banner')).toContainText('Sample of 2 rows');

  await node(page, 'customers.csv').click();
  await page.getByRole('switch', { name: 'Keep result in memory' }).click();
  // Built from the sampled copy the flow evaluates, so it counts as up to date rather than waiting forever.
  await expect(page.getByTestId('keep-memory')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  await expect(node(page, 'customers.csv').getByTestId('node-kept')).not.toHaveAttribute('data-stale', 'true');
  await expect.poll(() => keptRows(page)).toBe(2);

  await page.getByTestId('sample-banner').getByRole('button', { name: 'Run on full data' }).click();
  await expect.poll(() => keptRows(page), { timeout: 20_000 }).toBe(4);
  await expect(page.getByTestId('keep-memory')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
});
