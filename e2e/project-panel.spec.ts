import { expect, test } from '@playwright/test';
import { addFiles, addStepNode, fixture, node, openApp, selectNode } from './helpers/app';

test('queries are listed in the project panel, read tables by name, and stay off the canvas', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-customers.csv'), fixture('shop-orders.csv')]);
  for (const name of ['shop-customers.csv', 'shop-orders.csv']) await expect(node(page, name)).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });

  // The panel is out of the way until a query needs it; its button brings it in, listing the tables.
  await expect(page.getByTestId('project-panel')).toHaveCount(0);
  await page.getByTestId('outline-toggle').click();
  const panel = page.getByTestId('project-panel');
  await expect(panel.getByRole('region', { name: 'Tables' }).getByRole('button')).toHaveText([/shop-customers\.csv/, /shop-orders\.csv/]);

  // A new query reads the selected table by name, and asks for a name of its own.
  await selectNode(page, 'shop-orders.csv');
  await panel.getByRole('button', { name: 'New query' }).click();
  const naming = page.getByRole('dialog', { name: 'Name this query' });
  await naming.getByLabel('Name').fill('Orders per customer');
  await naming.getByRole('button', { name: 'Name it' }).click();
  const row = panel.getByTestId('outline-Orders per customer');
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(row).toContainText('reads shop-orders.csv');
  await expect(row).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });

  // It is in the list only: no card and no wire on the canvas, and the table says it is read.
  await expect(node(page, 'Orders per customer')).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(node(page, 'shop-orders.csv').getByTestId('read-by')).toHaveText('Read by 1 query');

  // Naming another table in the SQL is enough to read it: no wire is drawn by hand.
  const query = page.getByLabel('SQL query');
  await query.fill('SELECT c.customer_id, count(*) AS orders\nFROM "shop-orders.csv" o JOIN "shop-customers.csv" c USING (customer_id)\nGROUP BY 1');
  await query.press('Control+Enter');
  await expect(row).toContainText('reads shop-orders.csv, shop-customers.csv');
  await expect(row).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(page.getByTestId('results-title')).toHaveText('Orders per customer');
  await expect(node(page, 'shop-customers.csv').getByTestId('read-by')).toHaveText('Read by 1 query');

  // The mark on a table leads back to the query after looking elsewhere.
  await selectNode(page, 'shop-customers.csv');
  await expect(row).not.toHaveAttribute('aria-current', 'true');
  await node(page, 'shop-customers.csv').getByTestId('read-by').click();
  await expect(row).toHaveAttribute('aria-current', 'true');

  // The project setting puts queries back on the canvas, wired as any node.
  await page.getByRole('tab', { name: 'Project' }).click();
  await page.getByRole('switch', { name: 'Keep queries in the project panel' }).click();
  await expect(node(page, 'Orders per customer')).toBeVisible();
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await expect(page.getByTestId('read-by')).toHaveCount(0);
  await panel.getByTestId('move-queries').click();
  await expect(node(page, 'Orders per customer')).toHaveCount(0);
});

const SCRIPT = `CREATE OR REPLACE TABLE log AS
SELECT DISTINCT "Document ID" AS docid, "User Name" AS user_name
FROM read_csv('log-*.csv', union_by_name = true)
WHERE "Document ID" IS NOT NULL;

CREATE OR REPLACE TABLE users AS
SELECT * FROM read_csv('sap_users.csv')`;

test('a script and its tables are one card, and a folded chain of steps is named for what it cleans', async ({ page }) => {
  await openApp(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Files as one table/ }).click();
  await (await chooser).setFiles(['log-2024-01.csv', 'log-2024-02.csv', 'sap_users.csv'].map((f) => fixture(`doclog/${f}`)));
  await expect(node(page, 'CSV files')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });

  // The script's node and the tables it creates are gathered into one card, which gives out each table.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /^SQL/ }).click();
  const query = page.getByLabel('SQL query');
  await query.fill(SCRIPT);
  await query.press('Control+Enter');
  const card = page.getByTestId('group-SQL 1');
  await expect(card).toHaveAttribute('data-outputs', 'log,users', { timeout: 20_000 });
  await expect(node(page, 'log')).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);

  // The tables are listed in the project panel, where a click shows a table's rows.
  await page.getByTestId('outline-toggle').click();
  const panel = page.getByTestId('project-panel');
  await expect(panel.getByRole('region', { name: 'Tables' }).getByRole('button')).toHaveText([/CSV files/, /log/, /users/]);
  await panel.getByTestId('outline-log').click();
  await expect(page.getByTestId('results-title')).toHaveText('log');

  // Two steps after the table, grouped as a chain, fold into one card named after the table they clean.
  await addStepNode(page, 'Trim whitespace', 'Transform 1');
  await addStepNode(page, 'Change case', 'Transform 2');
  await node(page, 'Transform 1').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Group the chain/ }).click();
  await expect(page.getByTestId('group-Clean log')).toHaveAttribute('data-outputs', 'Transform 2');
  await expect(panel.getByRole('region', { name: 'Tables' }).getByRole('button')).toHaveText([/CSV files/, /log/, /users/, /Transform 2/]);
});
