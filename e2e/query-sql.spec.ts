import { expect, test, type Page } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp } from './helpers/app';

/** Customers and orders joined in a new Query, with order_id, name and total in the grid. */
async function shopQuery(page: Page) {
  await openApp(page);
  await addFiles(page, [fixture('shop-customers.csv'), fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok');
  await node(page, 'shop-customers.csv').click();
  await node(page, 'shop-orders.csv').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Query/ }).click();
  const field = (table: number, column: string) => page.getByTestId(`query-field-${table}-${column}`);
  await field(1, 'customer_id').dragTo(field(2, 'customer_id'));
  for (const [table, column] of [[2, 'order_id'], [1, 'name'], [2, 'total']] as const) await field(table, column).dblclick();
  await expectRows(page, 5);
}

test('the SQL view: the design as SQL, edited SQL back into the design, and SQL the grid can’t show kept as written', async ({ page }) => {
  await shopQuery(page);
  const designer = page.getByTestId('query-designer');
  const sql = designer.getByLabel('SQL', { exact: true });

  // The design as SQL.
  await designer.getByRole('tab', { name: 'SQL' }).click();
  await expect(sql).toHaveValue(['SELECT "shop-orders.csv".order_id, "shop-customers.csv".name, "shop-orders.csv".total', 'FROM "shop-customers.csv"', '  INNER JOIN "shop-orders.csv" ON "shop-customers.csv".customer_id = "shop-orders.csv".customer_id'].join('\n'));

  // Edit it, and the grid follows: a criterion, a sort and a new name.
  await sql.fill('SELECT order_id, name AS customer, total\nFROM "shop-customers.csv" c JOIN "shop-orders.csv" o ON c.customer_id = o.customer_id\nWHERE total > 5\nORDER BY total DESC');
  await sql.press('Control+Enter');
  await expectRows(page, 2);
  await designer.getByRole('tab', { name: 'Design' }).click();
  await expect(page.getByLabel('Criteria value for total')).toHaveValue('5');
  await expect(page.getByLabel('Sort total')).toHaveValue('desc');
  await expect(page.getByLabel('Name for name')).toHaveValue('customer');

  // Back in SQL, the design is written with its tables' own names, not the short names typed.
  await designer.getByRole('tab', { name: 'SQL' }).click();
  await expect(sql).toHaveValue(/^SELECT "shop-orders\.csv"\.order_id, "shop-customers\.csv"\.name AS customer, .*\nFROM "shop-customers\.csv"\n {2}INNER JOIN "shop-orders\.csv" ON /);

  // LIMIT is the grid's Top values, both ways.
  await sql.fill('SELECT name, total FROM "shop-customers.csv" c JOIN "shop-orders.csv" o ON c.customer_id = o.customer_id WHERE total > 5 ORDER BY total DESC LIMIT 1');
  await sql.press('Control+Enter');
  await expectRows(page, 1);
  await designer.getByRole('tab', { name: 'Design' }).click();
  await expect(designer.getByLabel('Top values')).toHaveValue('1');

  // SQL the grid can't show runs as written, and says why; going back to the design discards it.
  await designer.getByRole('tab', { name: 'SQL' }).click();
  await sql.fill('SELECT name, total FROM "shop-customers.csv" c JOIN "shop-orders.csv" o ON c.customer_id = o.customer_id ORDER BY total DESC LIMIT 1 OFFSET 1');
  await sql.press('Control+Enter');
  await expect(designer.getByTestId('query-sql-kept')).toContainText('OFFSET has no place in the design grid');
  await expect(designer.getByRole('tab', { name: 'Design' })).toBeDisabled();
  await expectRows(page, 1);
  await designer.getByTestId('query-sql-kept').getByRole('button', { name: 'Back to the design' }).click();
  await expect(page.getByLabel('Criteria value for total')).toHaveValue('5');
  await expectRows(page, 1);
  await designer.getByLabel('Top values').selectOption('All');
  await expectRows(page, 2);
});

// Regression: SQL kept before the grid could show it (a LIMIT, before Top values) kept the Design tab greyed out.
test('kept SQL the grid can show now opens in the design', async ({ page }) => {
  await shopQuery(page);
  const designer = page.getByTestId('query-designer');
  const sql = 'SELECT o.order_id, c.name, o.total FROM "shop-customers.csv" AS c JOIN "shop-orders.csv" AS o ON c.customer_id = o.customer_id limit 2';
  await page.evaluate((sql) => {
    const { store } = globalThis.__puddle as unknown as { store: { getState(): { apply(edit: (p: { nodes: Array<{ type: string; querySpec?: object }> }) => unknown): void } } };
    store.getState().apply((p) => ({ ...p, nodes: p.nodes.map((n) => (n.type === 'query' ? { ...n, querySpec: { ...n.querySpec, sql } } : n)) }));
  }, sql);
  await expect(designer.getByRole('tab', { name: 'SQL' })).toHaveAttribute('aria-selected', 'true');
  await expectRows(page, 2);
  await designer.getByRole('tab', { name: 'Design' }).click();
  await expect(designer.getByLabel('Top values')).toHaveValue('2');
  await expectRows(page, 2);
});
