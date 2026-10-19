import { expect, test, type Page } from '@playwright/test';
import { openApp } from './helpers/app';

const openSchema = async (page: Page) => {
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
  await expect(page.getByTestId('schema-view')).toBeVisible();
};

const editor = (page: Page) => page.getByRole('combobox', { name: 'DBML' });

test('the Schema view draws the tables and refs typed as DBML, marks a mistake until it is fixed, and keeps the DBML', async ({ page }) => {
  await openApp(page);
  await openSchema(page);
  await expect(page.getByText('Write a Table in the editor to see it here')).toBeVisible();

  // Typed with the keyboard: Enter keeps the indent and steps in after a brace, and Tab takes a suggestion.
  await editor(page).click();
  await page.keyboard.type('Table customers {');
  await page.keyboard.press('Enter');
  await page.keyboard.type('id int [pk]');
  await page.keyboard.press('Enter');
  await page.keyboard.type('email varchar');
  await page.keyboard.press('Enter');
  await page.keyboard.type('}');
  await expect(editor(page)).toHaveValue('Table customers {\n  id int [pk]\n  email varchar\n}');
  await expect(page.getByTestId('schema-table-customers')).toBeVisible();
  await expect(page.getByTestId('schema-col-customers-email')).toBeVisible();

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Table orders {');
  await page.keyboard.press('Enter');
  await page.keyboard.type('id int [pk]');
  await page.keyboard.press('Enter');
  await page.keyboard.type('customer_id int [ref: > cust');
  await expect(page.getByRole('option', { name: /customers\.id/ })).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.type(']');
  await page.keyboard.press('Enter');
  await page.keyboard.type('}');
  await expect(page.getByTestId('schema-ref-orders-customers')).toBeVisible();
  await expect(page.getByTestId('schema-counts')).toHaveText('2 tables, 1 ref');

  // A mistake is listed with its line and the tables that still read stay drawn; fixing it clears it.
  const text = await editor(page).inputValue();
  await editor(page).fill(text.replace('email varchar', 'email'));
  await expect(page.getByTestId('schema-errors')).toContainText('Line 3 The column "email" needs a type');
  await expect(page.getByTestId('schema-table-orders')).toBeVisible();
  await page.getByTestId('schema-errors').getByRole('button', { name: 'Line 3' }).click();
  await expect(editor(page)).toBeFocused();
  await editor(page).fill(text);
  await expect(page.getByTestId('schema-errors')).not.toBeAttached();

  // Clicking a column in the diagram selects it in the DBML.
  await page.getByTestId('schema-col-orders-customer_id').click();
  expect(await editor(page).evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('customer_id int [ref: > customers.id]');

  // The DBML is saved with the project.
  await page.getByRole('button', { name: 'Back to canvas' }).click();
  await expect(page.getByTestId('schema-view')).not.toBeAttached();
  await page.waitForTimeout(800);
  await page.reload();
  await openSchema(page);
  await expect(editor(page)).toHaveValue(text);
  await expect(page.getByTestId('schema-table-orders')).toBeVisible();
});
