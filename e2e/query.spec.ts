import { expect, test, type Page } from '@playwright/test';
import { addFiles, cell, expectRows, fixture, node, openApp } from './helpers/app';

/** Customers and orders on the canvas, selected in that order, then Add node › Query: the designer opens on them. */
async function queryShop(page: Page) {
  await openApp(page);
  await addFiles(page, [fixture('shop-customers.csv'), fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-customers.csv')).toHaveAttribute('data-status', 'ok');
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok');
  await node(page, 'shop-customers.csv').click();
  await node(page, 'shop-orders.csv').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: /Query/ }).click();
  await expect(page.getByTestId('query-designer')).toBeVisible();
}

const field = (page: Page, table: number, column: string) => page.getByTestId(`query-field-${table}-${column}`);
const drop = (page: Page) => page.getByTestId('grid-drop');

/** Where the Query keeps a table in the designer, from the project itself. */
const tablePlace = (page: Page, port: number) =>
  page.evaluate((p) => {
    const { store } = globalThis.__puddle as unknown as { store: { getState(): { history: { present: { nodes: Array<{ type: string; querySpec?: { tables: Array<{ port: number; x: number; y: number }> } }> } } } } };
    return store.getState().history.present.nodes.find((n) => n.type === 'query')!.querySpec!.tables.find((t) => t.port === p)!;
  }, port);

test('designing a query: tables in, a key dragged onto a key joins them, fields dragged into the grid', async ({ page }) => {
  await queryShop(page);
  const designer = page.getByTestId('query-designer');
  await expect(page.getByTestId('query-designer-title')).toHaveText('Query 1');
  await expect(designer.getByTestId('query-table-1')).toContainText('shop-customers.csv');
  await expect(designer.getByTestId('query-table-2')).toContainText('shop-orders.csv');
  await expect(field(page, 1, 'name')).toBeVisible();

  // Not joined yet, so the designer says the tables would pair every row with every row.
  await expect(designer.getByTestId('query-cross-join')).toContainText('shop-orders.csv has no join line');

  // Drag the customer's key onto the order's customer id: a join line.
  await field(page, 1, 'customer_id').dragTo(field(page, 2, 'customer_id'));
  await expect(designer.getByTestId('query-join-line')).toHaveCount(1);
  await expect(designer.getByTestId('query-cross-join')).toHaveCount(0);
  const inspector = page.getByTestId('inspector-query');
  await expect(inspector.getByTestId('query-join')).toContainText('shop-customers.csv.customer_id = shop-orders.csv.customer_id');
  await expect(inspector.getByLabel('Join 1 keeps')).toHaveValue('inner');

  // Nothing in the grid yet.
  await expect(node(page, 'Query 1')).toHaveCount(0); // the canvas is hidden while designing
  await expect(page.getByTestId('inspector').getByText('This node can’t run')).toBeVisible();
  await expect(page.getByTestId('inspector')).toContainText('Drag fields from the tables into the grid');

  // Fields: dragged onto the grid, or double-clicked.
  await field(page, 2, 'order_id').dragTo(drop(page));
  await field(page, 1, 'name').dblclick();
  await field(page, 2, 'total').dragTo(drop(page));
  await expect(page.getByTestId('query-grid').locator('.puddle-qd-colhead .ui-col')).toHaveText(['order_id', 'name', 'total']);
  await expect(page.getByTestId('inspector-columns').locator('.ui-col')).toHaveText(['order_id', 'name', 'total']);
  await expect(page.getByTestId('results-title')).toHaveText('Query 1');
  await expectRows(page, 5);

  // Sort by order id; the first row is order 100, Ada's.
  await page.getByLabel('Sort order_id').selectOption({ label: 'Ascending' });
  await expect(cell(page, 0, 0)).toHaveText('100');
  await expect(cell(page, 1, 0)).toHaveText('Ada');

  // Every row of orders keeps order 103, whose customer isn't in the customers file.
  await inspector.getByLabel('Join 1 keeps').selectOption({ label: 'Every row of the second table' });
  await expectRows(page, 6);

  // Criteria: only orders over 5.
  await page.getByLabel('Criteria for total').selectOption({ label: 'More than' });
  await page.getByLabel('Criteria value for total').fill('5');
  await page.getByLabel('Criteria value for total').press('Enter');
  await expectRows(page, 3);

  // Rename a field, and move it to the front by dragging its column.
  await page.getByLabel('Name for name').fill('customer');
  await page.getByLabel('Name for name').press('Enter');
  await page.getByTestId('grid-field-2').locator('.puddle-qd-colhead').dragTo(page.getByTestId('grid-field-1'));
  await expect(page.getByTestId('inspector-columns').locator('.ui-col')).toHaveText(['customer', 'order_id', 'total']);

  // Back to the canvas: the Query node is wired to both files and runs.
  await page.getByRole('button', { name: 'Back to canvas' }).click();
  const query = node(page, 'Query 1');
  await expect(query).toHaveAttribute('data-status', 'ok');
  await expect(query).toContainText('Query · 2 tables');
  await expect(page.getByTestId('wire-shop-customers.csv->Query 1')).toHaveAttribute('data-port', '0');
  await expect(page.getByTestId('wire-shop-orders.csv->Query 1')).toHaveAttribute('data-port', '1');

  // Its inspector opens the designer again, just as it was.
  await query.click();
  await page.getByRole('button', { name: 'Open query designer' }).click();
  await expect(page.getByTestId('query-join-line')).toHaveCount(1);
  await expect(page.getByLabel('Criteria value for total')).toHaveValue('5');
});

test('tables come and go from the designer, taking their fields and join lines, and undo brings them back', async ({ page }) => {
  await queryShop(page);
  await field(page, 1, 'customer_id').dragTo(field(page, 2, 'customer_id'));
  await field(page, 1, 'name').dblclick();
  await field(page, 2, 'total').dblclick();
  await expect(page.getByTestId('query-grid').locator('.puddle-qd-colhead .ui-col')).toHaveText(['name', 'total']);

  await page.getByRole('button', { name: 'Remove shop-orders.csv from the query' }).click();
  await expect(page.getByTestId('query-table-2')).toHaveCount(0);
  await expect(page.getByTestId('query-join-line')).toHaveCount(0);
  await expect(page.getByTestId('query-grid').locator('.puddle-qd-colhead .ui-col')).toHaveText(['name']);
  await expectRows(page, 5);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('query-table-2')).toBeVisible();
  await expect(page.getByTestId('query-join-line')).toHaveCount(1);
  await expectRows(page, 5);

  // Add table offers the files again; a second orders table sits in input 3, not joined to anything yet.
  await page.getByRole('button', { name: 'Add table' }).click();
  await page.getByRole('menuitem', { name: /shop-orders\.csv/ }).click();
  await expect(page.getByTestId('query-table-3')).toContainText('shop-orders.csv');
  await expect(page.getByTestId('query-cross-join')).toBeVisible();

  // Selecting a join line and pressing Delete removes it.
  await page.getByTestId('query-join-line').locator('.puddle-qd-hit').click({ force: true });
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('query-join-line')).toHaveCount(0);
});

test('a table moved in the designer stays where it was put, with its join lines following', async ({ page }) => {
  await queryShop(page);
  await field(page, 1, 'customer_id').dragTo(field(page, 2, 'customer_id'));
  const table = page.getByTestId('query-table-2');
  const before = await tablePlace(page, 1);
  const head = table.locator('.puddle-qd-table__head');
  const at = (await head.boundingBox())!;
  await page.mouse.move(at.x + 40, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + 200, at.y + at.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  const moved = await tablePlace(page, 1);
  expect(moved).toEqual({ port: 1, x: before.x + 160, y: before.y + 60 });
  // The join line follows the table down.
  const path = page.getByTestId('query-join-line').locator('path').first();
  await expect.poll(async () => Math.round((await path.boundingBox())!.height)).toBeGreaterThan(50);

  await page.getByRole('button', { name: 'Back to canvas' }).click();
  await node(page, 'Query 1').click();
  await page.getByRole('button', { name: 'Open query designer' }).click();
  await expect(page.getByTestId('query-join-line')).toHaveCount(1);
  expect(await tablePlace(page, 1)).toEqual(moved);
});
