import { expect, test } from '@playwright/test';
import { fixtureText, openApp } from './helpers/app';

test('a table filled with sample data gets rows that keep its refs, shown in its data sample', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
  await page.getByRole('combobox', { name: 'DBML' }).fill(fixtureText('dbml/shop.dbml'));
  await expect(page.getByTestId('schema-table-orders')).toBeVisible();

  // Orders refer to customers, which have no rows, so customers are filled too.
  await page.getByTestId('schema-table-orders').locator('.puddle-schema-table__head').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Fill with sample data…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Fill with sample data' });
  await expect(dialog.getByTestId('fill-sample-tables')).toContainText('Rows for orders, and for customers');
  await dialog.getByLabel('Rows per table').fill('8');
  await dialog.getByRole('button', { name: 'Fill' }).click();
  await expect(dialog).toBeHidden();

  const dbml = page.getByRole('combobox', { name: 'DBML' });
  await expect(dbml).toContainText('records customers(');
  await expect(dbml).toContainText('records orders(');

  // The data sample: the first rows, and how many there are.
  await page.getByTestId('schema-table-orders').locator('.puddle-schema-table__head').hover();
  const sample = page.getByTestId('schema-sample');
  await expect(sample.locator('tbody tr')).toHaveCount(5, { timeout: 20_000 });
  await expect(sample.locator('th').first()).toHaveText('id');
});
