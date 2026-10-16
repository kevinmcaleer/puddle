import { expect, test, type Page } from '@playwright/test';
import { addFiles, addStep, cell, fixture, node, openApp } from './helpers/app';

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
const settings = (page: Page) => page.getByTestId('step-settings');

async function transform(page: Page, name = 'Transform 1') {
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await expect(node(page, name)).toHaveAttribute('data-status', 'ok');
  await node(page, name).click();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
});

test('a column from an expression, with column suggestions as you type', async ({ page }) => {
  await transform(page);
  await addStep(page, 'Add column from expression');
  await settings(page).getByLabel('Name').fill('domain');
  await settings(page).getByLabel('Name').press('Enter');
  const expr = settings(page).getByRole('combobox');
  await expr.click();
  await expr.pressSequentially("split_part(em");
  await expect(page.getByRole('listbox', { name: 'Columns' }).getByRole('option').locator('.ui-col')).toHaveText(['email']);
  await expr.press('Tab');
  await expr.pressSequentially(", '@', 2)");
  await expect(expr).toHaveValue("split_part(email, '@', 2)");
  await expr.blur();
  await expect(steps(page)).toHaveText([/Added domain/]);
  await expect(cell(page, 4, 0)).toHaveText('example.com');

  // A mistake shows on the step, in words.
  await expr.fill('nope + 1');
  await expr.blur();
  await expect(settings(page).getByText('This step can’t run')).toBeVisible();
  await expect(settings(page)).toContainText('nope');
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'error');
});

test('split by delimiter and change type', async ({ page }) => {
  await transform(page);
  await addStep(page, 'Split by delimiter');
  await settings(page).getByRole('button', { name: 'email', exact: true }).click();
  await settings(page).getByLabel('Delimiter').fill('@');
  await settings(page).getByLabel('Delimiter').press('Enter');
  await settings(page).getByLabel('New columns').fill('user, domain');
  await settings(page).getByLabel('New columns').press('Enter');
  await expect(steps(page)).toHaveText([/Split email on "@"/]);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', 'id,name,joined,user,domain');
  await expect(cell(page, 3, 0)).toHaveText('ADA');

  await addStep(page, 'Change type');
  await settings(page).getByRole('button', { name: 'joined', exact: true }).click();
  await settings(page).getByLabel('New type').selectOption('date');
  await expect(steps(page).nth(1)).toHaveText(/Changed joined to date/);
  await expect(cell(page, 2, 3)).toHaveText('null');
});

test('removing a column the next node relies on breaks the wire between them', async ({ page }) => {
  await transform(page);
  await transform(page, 'Transform 2');
  await addStep(page, 'Duplicate column');
  await settings(page).getByRole('button', { name: 'email', exact: true }).click();
  await expect(node(page, 'Transform 2')).toHaveAttribute('data-status', 'ok');

  await node(page, 'Transform 1').click();
  await addStep(page, 'Remove columns');
  await settings(page).getByRole('button', { name: 'email', exact: true }).click();
  await expect(node(page, 'Transform 2')).toHaveAttribute('data-status', 'error');
  await expect(page.getByTestId('wire-Transform 1->Transform 2')).toHaveAttribute('data-state', 'broken');
});
