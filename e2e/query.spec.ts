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

test('a table follows the pointer when the moves land outside its header', async ({ page }) => {
  // Regression (WebKit): the moves were heard on the header only, relying on pointer capture to keep them there. In
  // WebKit they went to whatever was under the pointer, which left the header at once, so the table never moved.
  // Here the press is on the header and every move, and the release, go to the element under the pointer.
  await queryShop(page);
  const before = await tablePlace(page, 1);
  const head = page.getByTestId('query-table-2').locator('.puddle-qd-table__head');
  const at = (await head.boundingBox())!;
  await head.evaluate((el, a) => {
    const x = a.x + 40;
    const y = a.y + a.height / 2;
    const send = (type: string, target: Element, dx: number, dy: number) =>
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x + dx, clientY: y + dy }));
    const under = (dx: number, dy: number) => document.elementFromPoint(x + dx, y + dy) ?? document.body;
    send('pointerdown', el, 0, 0);
    for (let i = 1; i <= 5; i++) send('pointermove', under(32 * i, 12 * i), 32 * i, 12 * i);
    send('pointerup', under(160, 60), 160, 60);
  }, at);
  expect(await tablePlace(page, 1)).toEqual({ port: 1, x: before.x + 160, y: before.y + 60 });
});

test('a table dragged by its header with the mouse moves with it', async ({ page }) => {
  await queryShop(page);
  const before = await tablePlace(page, 1);
  const head = page.getByTestId('query-table-2').locator('.puddle-qd-table__head');
  const at = (await head.boundingBox())!;
  await page.mouse.move(at.x + 40, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + 200, at.y + at.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  expect(await tablePlace(page, 1)).toEqual({ port: 1, x: before.x + 160, y: before.y + 60 });
});

test('a table moved in the designer stays where it was put, with its join lines following', async ({ page }) => {
  await queryShop(page);
  await field(page, 1, 'customer_id').dragTo(field(page, 2, 'customer_id'));
  // The drop has landed (WebKit finishes a native drag after the mouse call returns) before the table is moved.
  await expect(page.getByTestId('query-join-line')).toHaveCount(1);
  // In Playwright's WebKit the next press after a native drag never reaches the page: CI recorded the header drag's
  // moves and release but no pointerdown, so the table couldn't move. A plain mouse drag with no field drag before it
  // moves the table there (the test above). A click on an empty corner of the designer, as a person's next click
  // would be, takes that press.
  await page.getByTestId('query-tables').click({ position: { x: 4, y: 4 } });
  const table = page.getByTestId('query-table-2');
  const before = await tablePlace(page, 1);
  const head = table.locator('.puddle-qd-table__head');
  const at = (await head.boundingBox())!;
  // What the page hears during the drag, to say why if the table doesn't move.
  await page.evaluate(() => {
    const seen: string[] = [];
    (globalThis as unknown as { seenPointer: string[] }).seenPointer = seen;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dragstart', 'lostpointercapture'])
      window.addEventListener(type, (e) => seen.push(`${type}@${(e.target as Element).className || (e.target as Element).tagName}`), true);
  });
  await page.mouse.move(at.x + 40, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + 200, at.y + at.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  const moved = await tablePlace(page, 1);
  const heard = await page.evaluate(() => (globalThis as unknown as { seenPointer: string[] }).seenPointer.join(', '));
  expect(moved, `pointer events: ${heard}`).toEqual({ port: 1, x: before.x + 160, y: before.y + 60 });
  // The join line follows the table down.
  const path = page.getByTestId('query-join-line').locator('path').first();
  await expect.poll(async () => Math.round((await path.boundingBox())!.height)).toBeGreaterThan(50);

  await page.getByRole('button', { name: 'Back to canvas' }).click();
  await node(page, 'Query 1').click();
  await page.getByRole('button', { name: 'Open query designer' }).click();
  await expect(page.getByTestId('query-join-line')).toHaveCount(1);
  expect(await tablePlace(page, 1)).toEqual(moved);
});

test('the Totals row groups and summarises, explains what can’t run, and turning it off restores the grid', async ({ page }) => {
  await queryShop(page);
  const designer = page.getByTestId('query-designer');
  const columns = page.getByTestId('inspector-columns').locator('.ui-col');
  await field(page, 1, 'customer_id').dragTo(field(page, 2, 'customer_id'));
  await expect(designer.getByTestId('query-join-line')).toHaveCount(1);
  await field(page, 1, 'name').dblclick();
  await field(page, 2, 'total').dblclick();
  await field(page, 2, 'order_id').dblclick();
  await expect(columns).toHaveText(['name', 'total', 'order_id']);
  await expectRows(page, 5);

  // Totals adds the Total row, every field grouped to begin with.
  const toggle = page.getByTestId('query-totals-toggle');
  await expect(page.getByLabel('Total for name')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Total for name')).toHaveValue('group');

  // Sum of total and Count of orders per customer, named as Access names them.
  await page.getByLabel('Total for total').selectOption({ label: 'Sum' });
  await page.getByLabel('Total for order_id').selectOption({ label: 'Count' });
  await expect(columns).toHaveText(['name', 'SumOftotal', 'CountOforder_id']);
  await expect(page.getByLabel('Name for total')).toHaveAttribute('placeholder', 'SumOftotal');
  await page.getByLabel('Sort name').selectOption({ label: 'Ascending' });
  await expectRows(page, 4);
  await expect(cell(page, 0, 0)).toHaveText('Ada');
  await expect(cell(page, 1, 0)).toHaveText('15.75');
  await expect(cell(page, 2, 0)).toHaveText('2');

  // Criteria on the sum filter the groups: only Ada's orders come to more than 10.
  await page.getByLabel('Criteria for total').selectOption({ label: 'More than' });
  await page.getByLabel('Criteria value for total').fill('10');
  await page.getByLabel('Criteria value for total').press('Enter');
  await expectRows(page, 1);
  await expect(cell(page, 1, 0)).toHaveText('15.75');

  // A sum of text is explained before anything runs.
  const problems = designer.getByTestId('query-totals-problems');
  await expect(problems).toHaveCount(0);
  await page.getByLabel('Total for name').selectOption({ label: 'Sum' });
  await expect(problems).toContainText('Sum needs numbers, and name is text.');
  await page.getByLabel('Total for name').selectOption({ label: 'Group by' });
  await expect(problems).toHaveCount(0);

  // A Where field filters rows before grouping: it mustn't show, and needs criteria.
  await field(page, 2, 'status').dblclick();
  await page.getByLabel('Total for status').selectOption({ label: 'Where' });
  await expect(problems).toContainText('status is a Where field: it filters rows before they’re grouped, so it can’t show.');
  // Regression: with banners above it the grid, a scroll container, shrank to nothing and its rows went under the
  // results panel. The designer scrolls instead, and the grid keeps every row.
  const grid = page.getByTestId('query-grid');
  expect(await grid.evaluate((el) => el.clientHeight >= el.scrollHeight - 1)).toBe(true);
  await page.getByLabel('Show status').click();
  await expect(problems).toContainText('status is a Where field, so give it criteria to filter on');
  await page.getByLabel('Criteria for status').selectOption({ label: 'Equals' });
  await page.getByLabel('Criteria value for status').fill('pending');
  await page.getByLabel('Criteria value for status').press('Enter');
  await expect(problems).toHaveCount(0);
  // Pending orders: Grace's 8.00 and Barbara's 1.00, neither more than 10.
  await expectRows(page, 0);
  await page.getByLabel('Criteria for total').selectOption({ label: 'No criteria' });
  await expectRows(page, 3);
  await expect(columns).toHaveText(['name', 'SumOftotal', 'CountOforder_id']);

  // Turning Totals off restores the grid as it was, with the Where field's criteria filtering rows again.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByLabel('Total for name')).toHaveCount(0);
  await expect(columns).toHaveText(['name', 'total', 'order_id']);
  await expectRows(page, 3);

  // And turning it on again brings the totals back; a summary can be renamed.
  await toggle.click();
  await expect(page.getByLabel('Total for total')).toHaveValue('sum');
  await page.getByLabel('Name for total').fill('Spend');
  await page.getByLabel('Name for total').press('Enter');
  await expect(columns).toHaveText(['name', 'Spend', 'CountOforder_id']);
});
