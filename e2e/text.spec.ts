import { expect, test, type Page } from '@playwright/test';
import { addFiles, addStep, cell, fixture, node, openApp } from './helpers/app';

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
const settings = (page: Page) => page.getByTestId('step-settings');

async function commit(page: Page, label: string, value: string) {
  await settings(page).getByLabel(label, { exact: true }).fill(value);
  await settings(page).getByLabel(label, { exact: true }).press('Enter');
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await node(page, 'Transform 1').click();
});

test('find and replace by pattern, with a broken pattern explained before it runs', async ({ page }) => {
  await addStep(page, 'Find and replace');
  await settings(page).getByRole('button', { name: 'name', exact: true }).click();
  await settings(page).getByRole('button', { name: 'joined', exact: true }).click();
  await settings(page).getByText('Use a regular expression').click();
  await commit(page, 'Find', '([0-9]{4}-');
  await expect(settings(page).getByText('Close every ( with a ).')).toBeVisible();

  await commit(page, 'Find', '([0-9]{4})-([0-9]{2})');
  await commit(page, 'Replace with', '\\2/\\1');
  await expect(settings(page).getByText('Close every ( with a ).')).toHaveCount(0);
  await expect(steps(page)).toHaveText([/Replaced/]);
  await expect(cell(page, 3, 0)).toHaveText('01/2024-31');
});

test('extract text between delimiters into a new column', async ({ page }) => {
  await addStep(page, 'Extract text');
  await settings(page).getByRole('button', { name: 'email', exact: true }).click();
  await settings(page).getByLabel('Extract').selectOption('between');
  await expect(settings(page).getByLabel('Characters')).toHaveCount(0);
  await commit(page, 'After', '@');
  await commit(page, 'Before', '.');
  await commit(page, 'New column', 'host');
  await expect(steps(page)).toHaveText([/Extracted text between @ and \. from email into host/]);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', 'id,name,email,joined,host');
  await expect(cell(page, 4, 0)).toHaveText('example');
  await expect(cell(page, 4, 2)).toHaveText('null');
});
