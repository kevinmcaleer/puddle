import { expect, test } from '@playwright/test';
import { openApp } from './helpers/app';

const BEFORE = 'Table customers {\n  id int [pk]\n}\n\nTable orders {\n  id int [pk]\n}\n';
const AFTER = 'Table customers {\n  id int [pk]\n}\n\nTable orders {\n  id int [pk]\n  customer_id int [ref: > customers.id]\n}\n';

test('a saved version is compared with the changed schema, with its migration, and restored with Undo', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
  const dbml = page.getByRole('combobox', { name: 'DBML' });
  await dbml.fill(BEFORE);
  await expect(page.getByTestId('schema-table-orders')).toBeVisible();

  await page.getByRole('button', { name: 'Versions' }).click();
  let dialog = page.getByRole('dialog', { name: 'Schema versions' });
  await dialog.getByLabel('Label').fill('Before refs');
  await dialog.getByRole('button', { name: 'Save version' }).click();
  await expect(dialog.getByTestId('version-Before refs')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  // A column and a ref added since: exactly those two changes.
  await dbml.fill(AFTER);
  await expect(page.getByTestId('schema-table-orders')).toContainText('customer_id');
  await page.getByRole('button', { name: 'Versions' }).click();
  dialog = page.getByRole('dialog', { name: 'Schema versions' });
  const changes = dialog.getByTestId('version-changes');
  await expect(changes.locator('li')).toHaveText(['Added column customer_id (int)', 'Added ref customer_id > customers.id']);

  await dialog.getByRole('tab', { name: 'Migration' }).click();
  const sql = dialog.getByTestId('migration-preview');
  await expect(sql).toContainText('ALTER TABLE "orders" ADD COLUMN "customer_id"');
  await expect(sql).toContainText('ADD FOREIGN KEY ("customer_id") REFERENCES "customers"');

  // Restore puts the saved text back, and Undo takes the restore back.
  await dialog.getByRole('button', { name: 'Actions for Before refs' }).click();
  await page.getByRole('menuitem', { name: /^Restore/ }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('schema-table-orders')).not.toContainText('customer_id');
  await page.getByTestId('schema-diagram').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('schema-table-orders')).toContainText('customer_id');
});
