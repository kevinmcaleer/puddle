import { expect, test } from '@playwright/test';
import { addFiles, expectRows, expectSql, fixture, node, openApp, queriesOnCanvas } from './helpers/app';

test('the DuckDB shell lists and describes the tables, makes and changes one on the canvas, and recalls commands', async ({ page }) => {
  await openApp(page);
  await queriesOnCanvas(page);
  await addFiles(page, [fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await page.getByTestId('console-toggle').click();
  const shell = page.getByTestId('sql-console');
  const prompt = page.getByLabel('Console query');
  const run = async (command: string) => {
    await prompt.fill(command);
    await prompt.press('Control+Enter');
  };

  // Every node is a table by its name.
  await run('.tables');
  await expect(shell.getByTestId('shell-tables')).toContainText('shop-orders.csv');
  await run('DESCRIBE "shop-orders.csv"');
  await expect(page.getByTestId('console-answer').locator('tbody tr')).toHaveCount(4);
  await expect(page.getByTestId('console-answer')).toContainText('customer_id');

  // A table made and filled in the shell is a SQL node's script, with the table's own node on the canvas.
  await run("CREATE TABLE notes (id INTEGER, note VARCHAR);\nINSERT INTO notes VALUES (1, 'first'), (2, 'second')");
  await expect(shell.getByTestId('shell-changed').last()).toContainText('notes has 2 rows');
  await expect(node(page, 'notes')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expectSql(page.getByLabel('SQL query'), "CREATE TABLE notes (id INTEGER, note VARCHAR);\nINSERT INTO notes VALUES (1, 'first'), (2, 'second')");

  // A change to it goes into the same script, and the shell shows the table as it is now.
  await run("UPDATE notes SET note = upper(note) WHERE id = 2");
  await expect(shell.getByTestId('shell-changed').last()).toContainText('Updated notes. notes has 2 rows');
  await expect(page.getByTestId('console-answer')).toContainText('SECOND');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await run('SELECT count(*) AS n FROM notes JOIN "shop-orders.csv" ON notes.id = 1');
  await expect(page.getByTestId('console-summary')).toContainText('1 row · 1 column');

  // What the browser can't do is refused before it runs, saying what to do instead.
  await run("ATTACH 'sales.duckdb'");
  await expect(shell.getByText('This query can’t run')).toBeVisible();
  await expect(shell).toContainText('add the database file (DuckDB, SQLite or Access) as a source from the Add menu');
  await expect(shell.getByRole('button', { name: 'Run' })).toBeDisabled();

  // Up brings back the commands run before.
  await prompt.fill('');
  await prompt.press('ArrowUp');
  await expect(prompt).toHaveText('SELECT count(*) AS n FROM notes JOIN "shop-orders.csv" ON notes.id = 1');
  await prompt.press('ArrowUp');
  await expect(prompt).toHaveText('UPDATE notes SET note = upper(note) WHERE id = 2');

  // A table in the shell opens in the results table in one click.
  await shell.getByRole('button', { name: 'View on the canvas' }).last().click();
  await expect(page.getByTestId('results-title')).toHaveText('notes');
  await expectRows(page, 2);
});
