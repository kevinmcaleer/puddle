import { expect, test } from '@playwright/test';
import { addFiles, expectRows, expectSql, fixture, node, openApp, selectNode } from './helpers/app';

test('the SQL editor colours a query and writes its keywords in capitals as they are typed', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /^SQL/ }).click();
  const sql = page.getByLabel('SQL query');
  await sql.fill('');

  // A keyword goes into capitals once it is finished; the word still being typed waits (or may yet be orders).
  await sql.pressSequentially('select * from "shop-orders.csv" where total > 5 or');
  await expectSql(sql, 'SELECT * FROM "shop-orders.csv" WHERE total > 5 or');
  await sql.pressSequentially('der by total desc');
  await expectSql(sql, 'SELECT * FROM "shop-orders.csv" WHERE total > 5 ORDER BY total desc');

  // Keywords are coloured as keywords; names, numbers and the table are not.
  await expect(sql.locator('.sql-keyword')).toHaveText(['SELECT', 'FROM', 'WHERE', 'ORDER', 'BY', 'desc']);
  await expect(sql.locator('.sql-number')).toHaveText(['5']);
  // A name in double quotes is a name, not a string.
  await expect(sql.locator('.sql-string')).toHaveCount(0);
  await expect(sql.locator('[data-mark]')).toHaveText(['"shop-orders.csv"']);

  // Enter is a new line, whatever is being suggested; Ctrl+Enter runs the query with every keyword in capitals.
  await sql.press('Enter');
  await sql.pressSequentially("-- from where 'select'");
  await sql.press('Control+Enter');
  await expectSql(sql, `SELECT * FROM "shop-orders.csv" WHERE total > 5 ORDER BY total DESC\n-- from where 'select'`);
  await expect(node(page, 'SQL 1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await selectNode(page, 'SQL 1');
  await expect(page.getByTestId('results-title')).toHaveText('SQL 1');
  await expectRows(page, 3);
});
