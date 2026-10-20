import { expect, test, type Page } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp, selectNode } from './helpers/app';

// Headless Chromium hides scrollbars; Firefox and WebKit on Linux draw classic ones that take room from the page.
// Showing them makes Chromium lay the query grid out the way they do.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

/** Customers and orders on the canvas, selected in that order, then Add node › Query: the designer opens on them. */
async function queryShop(page: Page) {
  await openApp(page);
  await addFiles(page, [fixture('shop-customers.csv'), fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-customers.csv')).toHaveAttribute('data-status', 'ok');
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok');
  await selectNode(page, 'shop-customers.csv');
  await selectNode(page, 'shop-orders.csv', ['Shift']);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Query/ }).click();
  await expect(page.getByTestId('query-designer')).toBeVisible();
}

const field = (page: Page, table: number, column: string) => page.getByTestId(`query-field-${table}-${column}`);

/** Set a criteria cell: its operator, then its value, committed with Enter. */
async function criteria(page: Page, what: string, column: string, op: string, value: string) {
  await page.getByLabel(`${what} for ${column}`).selectOption({ label: op });
  await page.getByLabel(`${what} value for ${column}`).fill(value);
  await page.getByLabel(`${what} value for ${column}`).press('Enter');
}

test('or rows: lapsed customers or customers with an order over 10, with undo, redo and removing the row', async ({ page }) => {
  await queryShop(page);
  // Every customer, with their orders where they have them, each customer once.
  await field(page, 1, 'customer_id').dragTo(field(page, 2, 'customer_id'));
  await expect(page.getByTestId('query-join-line')).toHaveCount(1);
  await page.getByTestId('inspector-query').getByLabel('Join 1 keeps').selectOption({ label: 'Every row of the first table' });
  await field(page, 1, 'name').dblclick();
  await field(page, 1, 'status').dblclick();
  await field(page, 2, 'total').dblclick();
  await page.getByLabel('Show total').click();
  await page.getByLabel('Show status').click();
  await page.getByText('Unique values').click();
  await page.getByLabel('Sort name').selectOption({ label: 'Ascending' });
  await expectRows(page, 5);

  // Lapsed customers: Barbara L and Edsger.
  await criteria(page, 'Criteria', 'status', 'Equals', 'lapsed');
  await expectRows(page, 2);

  // An or row: or an order over 10, which is Ada's.
  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });
  await expect(page.getByTestId('grid-or-1')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add or row' }).click();
  await expect(page.getByTestId('grid-or-1')).toBeVisible();
  await expectRows(page, 2); // an empty row changes nothing
  await criteria(page, 'Or 1', 'total', 'More than', '10');
  await expectRows(page, 3);
  await expect(page.getByLabel('Criteria value for status')).toHaveValue('lapsed');

  // Every row of the grid, the or row and the one that adds rows included, is in view above the grid's scrollbar.
  const fit = await page.getByTestId('query-grid-scroll').evaluate((el) => ({
    last: el.querySelector('tr:last-child')!.getBoundingClientRect().bottom,
    shown: el.getBoundingClientRect().top + el.clientTop + el.clientHeight,
  }));
  expect(fit.last).toBeLessThanOrEqual(fit.shown + 0.5);

  // Undo and redo the edit.
  await undo.click();
  await expect(page.getByLabel('Or 1 value for total')).toHaveValue('');
  await redo.click();
  await expect(page.getByLabel('Or 1 value for total')).toHaveValue('10');
  await expectRows(page, 3);

  // Removing the or row gives the query as it was; undo brings it back, redo removes it again.
  await page.getByRole('button', { name: 'Remove or row 1' }).click();
  await expect(page.getByTestId('grid-or-1')).toHaveCount(0);
  await expectRows(page, 2);
  await undo.click();
  await expect(page.getByLabel('Or 1 value for total')).toHaveValue('10');
  await expectRows(page, 3);
  await redo.click();
  await expect(page.getByTestId('grid-or-1')).toHaveCount(0);
  await expectRows(page, 2);

  // Undo past the adding of the row too.
  await undo.click();
  await undo.click();
  await undo.click();
  await expect(page.getByTestId('grid-or-1')).toBeVisible();
  await expect(page.getByLabel('Or 1 for total')).toHaveValue('');
  await undo.click();
  await expect(page.getByTestId('grid-or-1')).toHaveCount(0);
  await expectRows(page, 2);
});
