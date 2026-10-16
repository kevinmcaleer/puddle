import { expect, test, type Page } from '@playwright/test';
import { addFiles, cell, expectRows, fixture, node, openApp } from './helpers/app';

// Headless Chromium hides scrollbars; Firefox and WebKit on Linux draw classic ones that take room from the page.
// Showing them makes Chromium lay the query grid out the way they do.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

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

/** Every row of the grid is inside what it shows, above its own horizontal scrollbar; whether it scrolls sideways. */
async function expectGridFits(page: Page) {
  const fit = await page.getByTestId('query-grid-scroll').evaluate((el) => {
    const top = el.getBoundingClientRect().top + el.clientTop;
    return { scrolls: el.scrollWidth > el.clientWidth, last: el.querySelector('tr:last-child')!.getBoundingClientRect().bottom, shown: top + el.clientHeight };
  });
  expect(fit.last).toBeLessThanOrEqual(fit.shown + 0.5);
  return fit.scrolls;
}

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
  await expectGridFits(page);
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

test('the grid keeps every row in view, with banners above it and more fields than fit across', async ({ page }) => {
  // Regression: with banners above it the grid, a scroll container, shrank to nothing and its rows went under the
  // results panel. Then, sized to its rows, it had no room for its own horizontal scrollbar where scrollbars take
  // space (Firefox), so the scrollbar covered the Criteria row.
  await queryShop(page);
  for (const c of ['customer_id', 'name', 'status']) await field(page, 1, c).dblclick();
  for (const c of ['order_id', 'customer_id', 'total', 'status']) await field(page, 2, c).dblclick();
  await page.getByTestId('query-totals-toggle').click();
  await page.getByLabel('Total for name').selectOption({ label: 'Sum' });
  await expect(page.getByTestId('query-totals-problems')).toBeVisible();
  await expect(page.getByTestId('query-cross-join')).toBeVisible();
  expect(await expectGridFits(page)).toBe(true);
  // The designer scrolls to the Criteria row, which takes clicks.
  await page.getByLabel('Criteria for total').selectOption({ label: 'More than' });
  await expect(page.getByLabel('Criteria value for total')).toBeVisible();
});
