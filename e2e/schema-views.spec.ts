import { expect, test } from '@playwright/test';
import { openApp, saved } from './helpers/app';

const DBML = `Table users {
  id integer [pk]
  email varchar
}

Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
  product_id integer [ref: > products.id]
  note text
}

Table products {
  id integer [pk]
  title varchar
}

Table reviews {
  id integer [pk]
  product_id integer [ref: > products.id]
}
`;

const openSchema = async (page: import('@playwright/test').Page) => {
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
};

test('a diagram view: made from a selection, tables added, detail level changed, and still there after reopening', async ({ page }) => {
  await openApp(page);
  await openSchema(page);
  await page.getByRole('combobox', { name: 'DBML' }).fill(DBML);
  await expect(page.getByTestId('schema-table-reviews')).toBeVisible();

  // Shift+click two tables and make a view of them: only they show, with the ref between them.
  await page.getByTestId('schema-table-users').locator('.puddle-schema-table__head').click({ modifiers: ['Shift'] });
  await page.getByTestId('schema-table-orders').locator('.puddle-schema-table__head').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'New view of 2' }).click();
  const views = page.getByTestId('schema-views');
  await expect(views.getByRole('tab', { name: /View 1/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('schema-table-products')).toHaveCount(0);
  await expect(page.getByTestId('schema-ref-orders-users')).toBeAttached();

  // Add a table from the view's list; its ref to orders appears with it.
  await views.getByLabel('Add tables').selectOption({ label: 'products' });
  await expect(page.getByTestId('schema-table-products')).toBeVisible();
  await expect(page.getByTestId('schema-ref-orders-products')).toBeAttached();
  await expect(page.getByTestId('schema-table-reviews')).toHaveCount(0);

  // Keys hides the columns that are neither keys nor in a ref, and keeps every line.
  await views.getByRole('button', { name: 'Keys' }).click();
  await expect(page.getByTestId('schema-col-orders-note')).toHaveCount(0);
  await expect(page.getByTestId('schema-col-orders-user_id')).toBeVisible();
  await expect(page.getByTestId('schema-ref-orders-users')).toBeAttached();
  await expect(page.getByTestId('schema-ref-orders-products')).toBeAttached();

  // Reopen: the view, its tables and its detail level are kept, and All tables still shows every table.
  await expect.poll(async () => (await saved(page))?.schema.views[0]?.detail).toBe('keys');
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await openSchema(page);
  await expect(views.getByRole('tab', { name: /View 1/ })).toHaveAttribute('aria-selected', 'true');
  await expect(views.getByRole('button', { name: 'Keys' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('schema-table-products')).toBeVisible();
  await expect(page.getByTestId('schema-table-reviews')).toHaveCount(0);
  await expect(page.getByTestId('schema-col-orders-note')).toHaveCount(0);
  await views.getByRole('tab', { name: /All tables/ }).click();
  await expect(page.getByTestId('schema-table-reviews')).toBeVisible();
  await expect(page.getByTestId('schema-col-orders-note')).toBeVisible();
});
