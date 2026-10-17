import { expect, test, type Page } from '@playwright/test';
import { addFiles, addStep, cell, fixture, node, openApp } from './helpers/app';

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
const settings = (page: Page) => page.getByTestId('step-settings');

async function transform(page: Page, name = 'Transform 1') {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
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
  await settings(page).getByLabel('Delimiter', { exact: true }).selectOption({ label: 'Custom' });
  await settings(page).getByLabel('Custom delimiter').fill('@');
  await settings(page).getByLabel('Custom delimiter').press('Enter');
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

test('split by delimiter with Power Query’s options: left-most and into rows', async ({ page }) => {
  await transform(page);
  await addStep(page, 'Split by delimiter');
  await settings(page).getByRole('button', { name: 'email', exact: true }).click();
  await settings(page).getByLabel('Delimiter', { exact: true }).selectOption({ label: 'Custom' });
  await settings(page).getByLabel('Custom delimiter').fill('.');
  await settings(page).getByLabel('Custom delimiter').press('Enter');
  await settings(page).getByLabel('Split at').selectOption({ label: 'Left-most delimiter' });
  await settings(page).getByLabel('New columns').fill('local, rest');
  await settings(page).getByLabel('New columns').press('Enter');
  await expect(steps(page)).toHaveText([/Split email at the first "\."/]);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', 'id,name,joined,local,rest');
  await expect(cell(page, 3, 0)).toHaveText('ADA@example');
  await expect(cell(page, 4, 0)).toHaveText('com');

  // Into rows: one row per part, the other columns repeated, and the new-column names no longer asked for.
  await settings(page).getByLabel('Split at').selectOption({ label: 'Each occurrence of the delimiter' });
  await settings(page).getByLabel('Split into').selectOption({ label: 'Rows' });
  await expect(settings(page).getByLabel('New columns')).toHaveCount(0);
  await expect(steps(page)).toHaveText([/Split email on "\." into rows/]);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', 'id,name,email,joined');
  await expect(cell(page, 2, 0)).toHaveText('ADA@example');
  await expect(cell(page, 2, 1)).toHaveText('com');
  await expect(cell(page, 0, 1)).toHaveText('1');
});

test('split by number of characters and by character transition', async ({ page }) => {
  await transform(page);
  await addStep(page, 'Split by number of characters');
  await settings(page).getByRole('button', { name: 'joined', exact: true }).click();
  await settings(page).getByLabel('Number of characters').fill('4');
  await settings(page).getByLabel('Number of characters').press('Enter');
  await settings(page).getByLabel('Split', { exact: true }).selectOption({ label: 'Once, as far left as possible' });
  await settings(page).getByLabel('New columns').fill('year, rest');
  await settings(page).getByLabel('New columns').press('Enter');
  await expect(steps(page)).toHaveText([/Split joined after the first 4 characters/]);
  await expect(cell(page, 3, 0)).toHaveText('2024');
  await expect(cell(page, 4, 0)).toHaveText('-01-31');

  await addStep(page, 'Split by character transition');
  await settings(page).getByRole('button', { name: 'email', exact: true }).click();
  await settings(page).getByLabel('Split from').selectOption({ label: 'Uppercase to lowercase' });
  await settings(page).getByLabel('New columns').fill('caps, tail');
  await settings(page).getByLabel('New columns').press('Enter');
  await expect(steps(page).nth(1)).toHaveText(/Split email from uppercase to lowercase/);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', 'id,name,year,rest,caps,tail');
  await expect(cell(page, 4, 0)).toHaveText('ADA@example.com');
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
