import { expect, test, type Page } from '@playwright/test';
import { addFiles, addStep, addStepNode, cell, fixture, node, openApp } from './helpers/app';

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
const settings = (page: Page) => page.getByTestId('step-settings');
const query = (page: Page) => settings(page).getByLabel('Query', { exact: true });

/** Type a query and apply it with Ctrl+Enter, as the editor's hint says. */
async function write(page: Page, sql: string) {
  await query(page).fill(sql);
  await query(page).press('Escape');
  await query(page).press('Control+Enter');
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('orders.tsv')]);
  await node(page, 'orders.tsv').click();
  await addStepNode(page, 'Custom SQL');
});

test('a grouped query runs as a step, and the next step sees its columns', async ({ page }) => {
  await expect(query(page)).toHaveValue('SELECT *\nFROM input');
  await expect(steps(page)).toHaveText([/Ran custom SQL/]);
  await write(page, 'SELECT customer_id, sum(total) AS spent\nFROM input -- one row per customer\nGROUP BY customer_id\nORDER BY customer_id;');
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', 'customer_id,spent');
  await expect(cell(page, 1, 0)).toHaveText('15.75');
  await expect(cell(page, 1, 1)).toHaveText('8.0');

  await addStep(page, 'Sort rows');
  await expect(steps(page)).toHaveText([/Ran custom SQL/, /Sort/]);
  await settings(page).getByLabel('Sort column 1', { exact: true }).selectOption('spent');
  await settings(page).getByLabel('Sort direction 1', { exact: true }).selectOption('asc');
  await expect(cell(page, 0, 0)).toHaveText('2');
});

test('a query that reads a file is refused before it runs, and says why', async ({ page }) => {
  await write(page, "SELECT * FROM read_csv('src_customers.csv')");
  const refused = settings(page).getByRole('alert').filter({ hasText: 'This query can’t run as a step' });
  await expect(refused).toContainText('Calling read_csv() isn’t allowed: a step can only read its input, not files or other tables.');
  await write(page, "SELECT 1 AS a; COPY input TO 'out.csv'");
  await expect(refused).toContainText('Write one query');
  await write(page, 'SELECT order_id FROM input');
  await expect(refused).toHaveCount(0);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', 'order_id');
});

test('a DuckDB error shows the line of the query it points at', async ({ page }) => {
  await write(page, 'SELECT customer_id,\n  sum(totl) AS spent\nFROM input\nGROUP BY 1');
  const failing = settings(page).getByRole('alert').filter({ hasText: 'This step can’t run' });
  await expect(failing).toContainText('totl');
  await expect(failing).toContainText('Line 2 of the query: sum(totl) AS spent');
});
