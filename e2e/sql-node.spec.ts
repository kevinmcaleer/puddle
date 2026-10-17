import { expect, test } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp, saved } from './helpers/app';

test('a console query is answered under the results, becomes a SQL node in one click, and refuses what it can’t allow', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });

  // The console opens from the results bar and reads the viewed node as `input`.
  await page.getByTestId('console-toggle').click();
  const console = page.getByTestId('sql-console');
  await expect(console).toContainText('Reads the rows of shop-orders.csv as input');
  const query = page.getByLabel('Console query');
  await query.fill('SELECT customer_id, count(*) AS orders FROM input GROUP BY 1 ORDER BY 2 DESC, 1');
  await query.press('Control+Enter');
  const answer = page.getByTestId('console-answer');
  await expect(answer.getByRole('columnheader')).toHaveText([/customer_id/, /orders/]);
  await expect(page.getByTestId('console-summary')).toContainText(/\d+ rows · 2 columns/);
  const rows = await answer.locator('tbody tr').count();
  expect(rows).toBeGreaterThan(1);
  // Nothing was added to the flow by looking.
  await expect(page.locator('.react-flow__node')).toHaveCount(1);

  // A query that reads a file, or a table that isn't input, is refused before it reaches DuckDB.
  await query.fill("SELECT * FROM read_csv('x.csv')");
  await query.press('Control+Enter');
  await expect(console.getByText('This query can’t run')).toBeVisible();
  await expect(console).toContainText(/read_csv/);
  await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Make a SQL node' })).toBeDisabled();
  // A query DuckDB itself refuses says so, with the line.
  await query.fill('SELECT nope FROM input');
  await query.press('Control+Enter');
  await expect(console.getByText('DuckDB refused the query')).toBeVisible();
  await expect(console).toContainText('Line 1 of the query: SELECT nope FROM input');

  // One click keeps the query as a SQL node after the viewed node, selected, with its result in the table.
  await query.fill('SELECT customer_id, count(*) AS orders FROM input GROUP BY 1');
  await query.press('Control+Enter');
  await expect(page.getByTestId('console-summary')).toBeVisible();
  await page.getByRole('button', { name: 'Make a SQL node' }).click();
  await expect(node(page, 'SQL 1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(page.getByTestId('inspector-sql')).toBeVisible();
  await expect(page.getByLabel('SQL query')).toHaveValue('SELECT customer_id, count(*) AS orders FROM input GROUP BY 1');
  await expect(page.getByTestId('sql-tables')).toContainText('shop-orders.csv');
  await expect(page.getByTestId('sql-tables')).toContainText('input1, input');
  await expect(page.getByTestId('results-title')).toHaveText('SQL 1');
  await expectRows(page, rows);
  // The console carries on against the new node; its old answer is gone.
  await expect(console).toContainText('Reads the rows of SQL 1 as input');
  await expect(page.getByTestId('console-answer')).toHaveCount(0);

  // Editing the node's query in the inspector re-runs it; a bad table name is explained in place.
  await page.getByLabel('SQL query').fill('SELECT * FROM orders');
  await page.getByLabel('SQL query').press('Control+Enter');
  await expect(page.getByTestId('inspector-sql').getByText('This query can’t run')).toBeVisible();
  await expect(node(page, 'SQL 1')).toHaveAttribute('data-status', 'error');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(node(page, 'SQL 1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });

  // A reload brings the node and its query back (the file itself waits to be chosen again).
  await expect.poll(async () => (await saved(page))?.nodes.map((n) => (n as { type: string }).type)).toEqual(['source', 'sql']);
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await expect(node(page, 'SQL 1')).toHaveAttribute('data-status', 'blocked');
  const kept = await page.evaluate(() => {
    const { store } = globalThis.__puddle as unknown as { store: { getState(): { history: { present: { nodes: Array<{ type: string; sqlSpec?: { query: string } }> } } } } };
    return store.getState().history.present.nodes.find((n) => n.type === 'sql')?.sqlSpec?.query;
  });
  expect(kept).toBe('SELECT customer_id, count(*) AS orders FROM input GROUP BY 1');
});
