import { expect, test, type Page } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp, selectNode } from './helpers/app';

const strip = (page: Page) => page.locator('.ui-strip');

/** Click a column header in the grid canvas; customers.csv's short names make every column 120px wide. */
async function selectColumn(page: Page, index: number) {
  const box = (await page.getByTestId('results-table').boundingBox())!;
  await page.mouse.click(box.x + 100 + 120 * index, box.y + 20);
}

test('the status strip profiles the selected column and tallies the viewed node’s rules', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await selectNode(page, 'customers.csv');
  await expectRows(page, 4);

  await selectColumn(page, 0);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-selected', 'id');
  await expect(page.getByTestId('column-profile')).toHaveText('id · about 4 distinct · 1 to 4 · 0% empty');
  await selectColumn(page, 2);
  await expect(page.getByTestId('column-profile')).toHaveText(/^email · about 3 distinct · .* · 25% empty$/);

  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('menuitem', { name: 'No leading or trailing spaces', exact: true }).click();
  await page.getByTestId('rule-settings').getByRole('button', { name: 'name', exact: true }).click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('menuitem', { name: 'Unique', exact: true }).click();
  await page.getByTestId('rule-settings').getByRole('button', { name: 'id', exact: true }).click();
  await expect(strip(page)).toContainText('1 pass', { timeout: 20_000 });
  await expect(strip(page)).toContainText('1 fail');
});
