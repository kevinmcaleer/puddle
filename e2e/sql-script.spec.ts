import { expect, test } from '@playwright/test';
import { expectRows, fixture, node, openApp, selectNode } from './helpers/app';

// Kev's script, on CSV: the file set's files read by pattern and by name, then tables reading the tables before them.
const SCRIPT = `CREATE OR REPLACE TABLE log AS
SELECT DISTINCT "Document ID" AS docid, "Document Log id" AS log_id, "User Name" AS user_name,
"Option Execute Cancelled" AS option_execute_cancelled
FROM read_csv('*.csv', union_by_name = true)
WHERE "Document ID" IS NOT NULL;

CREATE OR REPLACE TABLE users AS
SELECT * FROM read_csv('sap_users.csv');

CREATE OR REPLACE TABLE docs AS
SELECT l.docid, COUNT() AS all_steps,
COUNT(*) FILTER (WHERE COALESCE(l.option_execute_cancelled,'') <> 'X' AND u."User Type" = 'A Dialog') AS human_steps
FROM log l
LEFT JOIN users u ON upper(trim(u."User Name")) = upper(trim(l.user_name))
GROUP BY l.docid`;

test('several files become one source, and a SQL script over them makes a node for each table it creates', async ({ page }) => {
  await openApp(page);

  // Files chosen together are one source, read as one table with their columns lined up by name.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Files as one table/ }).click();
  await (await chooser).setFiles(['log-2024-01.csv', 'log-2024-02.csv', 'sap_users.csv'].map((f) => fixture(`doclog/${f}`)));
  await expect(node(page, 'CSV files')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'CSV files')).toContainText('3 CSV files');
  await expect(page.getByTestId('file-set-summary')).toContainText('3 CSV files, read as one table');
  await expectRows(page, 10);

  // A SQL node after it takes the whole script: each table it creates gets a node of its own.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /^SQL/ }).click();
  await expect(page.getByTestId('sql-files')).toContainText('sap_users.csv');
  const query = page.getByLabel('SQL query');
  await query.fill(SCRIPT);
  await query.press('Control+Enter');
  await expect(node(page, 'SQL 1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'SQL 1')).toContainText('SQL script · 3 tables');
  await expect(page.getByTestId('sql-script-tables')).toContainText('docs');
  for (const table of ['log', 'users', 'docs']) await expect(node(page, table)).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });

  // Each table node holds its table's rows: the log without the users file's rows or the repeated line.
  await selectNode(page, 'log');
  await expect(page.getByTestId('inspector-script-table')).toBeVisible();
  await expect(page.getByTestId('results-title')).toHaveText('log');
  await expectRows(page, 5);

  // Narrowing the set to the log files changes what the script reads: the users file no longer matches its name.
  await selectNode(page, 'CSV files');
  await page.getByLabel('Only files matching').fill('log-*');
  await page.getByLabel('Only files matching').press('Enter');
  await expect(node(page, 'CSV files')).toContainText('2 CSV files');
  await expect(node(page, 'SQL 1')).toHaveAttribute('data-status', 'error');
  await selectNode(page, 'SQL 1');
  await expect(page.getByTestId('inspector-sql').getByText('This script can’t run')).toBeVisible();
  await expect(page.getByTestId('inspector-sql')).toContainText('In users: no file wired into this node is called sap_users.csv.');
});

test('a script DuckDB refuses says why in plain words, with the line of the script', async ({ page }) => {
  await openApp(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Files as one table/ }).click();
  await (await chooser).setFiles(['log-2024-01.csv', 'log-2024-02.csv'].map((f) => fixture(`doclog/${f}`)));
  await expect(node(page, 'CSV files')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /^SQL/ }).click();

  // FILTER written as a function: a syntax error on the script's line 6, far further down what Puddle sends.
  const query = page.getByLabel('SQL query');
  await query.fill(`CREATE OR REPLACE TABLE log AS
SELECT "Document ID" AS docid, "User Name" AS user_name FROM input1;

CREATE OR REPLACE TABLE doc_user AS
SELECT docid,
FILTER ((WHERE user_name IS NOT NULL), '0') AS user_name
FROM log
GROUP BY docid`);
  await query.press('Control+Enter');
  await expect(node(page, 'SQL 1')).toHaveAttribute('data-status', 'error', { timeout: 20_000 });
  const refused = page.getByRole('alert').filter({ hasText: 'DuckDB refused the script' });
  await expect(refused).toContainText(`The SQL couldn't be read: syntax error at or near "WHERE".`);
  await expect(refused).toContainText("Line 6: FILTER ((WHERE user_name IS NOT NULL), '0') AS user_name");
  await expect(refused).not.toContainText('exception_type');
});
