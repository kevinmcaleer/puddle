import { expect, test, type Page } from '@playwright/test';
import { addFiles, addStepNode, fixture, node, openApp, selectNode } from './helpers/app';

type Engine = { query(sql: string): Promise<{ table: { toArray(): Array<{ toJSON(): Record<string, unknown> }> } }> };
type Puddle = { engine: Engine; kept: { setState(s: { limit: number }): void } };

/** Run a query on the page's engine and return its rows. */
const rowsOf = (page: Page, sql: string) =>
  page.evaluate(async (q) => {
    const r = await (globalThis as unknown as { __puddle: Puddle }).__puddle.engine.query(q);
    return r.table.toArray().map((row) => JSON.parse(JSON.stringify(row.toJSON(), (_k, v) => (typeof v === 'bigint' ? Number(v) : v))) as Record<string, unknown>);
  }, sql);

const keptTables = async (page: Page) => (await rowsOf(page, `SELECT table_name FROM duckdb_tables() WHERE table_name LIKE 'kept\\_%' ESCAPE '\\' ORDER BY 1`)).map((r) => String(r.table_name));

const keepSwitch = (page: Page) => page.getByRole('switch', { name: 'Keep result in memory' });
const memory = (page: Page) => page.getByTestId('keep-memory');

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('orders.tsv')]);
  await selectNode(page, 'orders.tsv');
  await addStepNode(page, 'Remove blank rows');
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
});

test('keeping a result builds a table, shows its memory, rebuilds on change and drops when turned off', async ({ page }) => {
  await expect(keepSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('kept-total')).toHaveCount(0);

  await keepSwitch(page).click();
  await expect(keepSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(memory(page)).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  await expect(memory(page)).toHaveText(/^Uses [\d.]+ (B|KB|MB)$/);
  await expect(node(page, 'Transform 1').getByTestId('node-kept')).toHaveText(/[\d.]+ (B|KB|MB) kept$/);
  await expect(page.getByTestId('kept-total')).toHaveText(/^[\d.]+ (B|KB|MB) kept$/);
  await expect.poll(() => keptTables(page)).toHaveLength(1);
  const [table] = await keptTables(page);

  // A new step changes what the node holds: the table is rebuilt with it.
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByRole('menuitem', { name: /^Sort rows/ }).click();
  const settings = page.getByTestId('step-settings');
  await settings.getByLabel('Sort column 1', { exact: true }).selectOption('total');
  await settings.getByLabel('Sort direction 1', { exact: true }).selectOption('asc');
  await expect(memory(page)).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  await expect.poll(async () => (await rowsOf(page, `SELECT CAST(total AS VARCHAR) AS t FROM "${table}"`)).map((r) => r.t)).toEqual(['3.25', '8.0', '12.5']);
  await expect(node(page, 'Transform 1').getByTestId('node-kept')).not.toHaveAttribute('data-stale', 'true');

  await keepSwitch(page).click();
  await expect(keepSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(memory(page)).toHaveCount(0);
  await expect(node(page, 'Transform 1').getByTestId('node-kept')).toHaveCount(0);
  await expect(page.getByTestId('kept-total')).toHaveCount(0);
  await expect.poll(() => keptTables(page)).toEqual([]);
});

test('warns before keeping another when kept results use much of the engine’s memory, and drops them all on closing the project', async ({ page }) => {
  await keepSwitch(page).click();
  await expect(memory(page)).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });

  // Pretend the engine has very little memory, so the kept result above is already over the line.
  await page.evaluate(() => (globalThis as unknown as { __puddle: Puddle }).__puddle.kept.setState({ limit: 1000 }));
  await selectNode(page, 'orders.tsv');
  await keepSwitch(page).click();
  const warning = page.getByRole('status').filter({ hasText: 'Memory is filling up' });
  await expect(warning).toContainText('Keeping another may leave too little for previews and exports.');
  await expect(keepSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await warning.getByRole('button', { name: 'Keep anyway' }).click();
  await expect(warning).toHaveCount(0);
  await expect(keepSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(memory(page)).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  await expect.poll(() => keptTables(page)).toHaveLength(2);

  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'All projects' }).click();
  await expect(page.getByTestId('home')).toBeVisible();
  await expect.poll(() => keptTables(page)).toEqual([]);
});
