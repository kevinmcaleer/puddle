import { expect, test, type Page } from '@playwright/test';
import { addFiles, cell, fixture, node, openApp } from './helpers/app';

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
const settings = (page: Page) => page.getByTestId('step-settings');
const chip = (page: Page, name: string) => settings(page).getByRole('button', { name, exact: true });

async function addStep(page: Page, title: string) {
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${title}`) }).click();
}

async function commit(page: Page, label: string, value: string) {
  await settings(page).getByLabel(label, { exact: true }).fill(value);
  await settings(page).getByLabel(label, { exact: true }).press('Enter');
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('numbers.csv')]);
  await node(page, 'numbers.csv').click();
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await node(page, 'Transform 1').click();
});

test('the Numbers group is in the Add step menu', async ({ page }) => {
  await page.getByRole('button', { name: 'Add step' }).click();
  for (const title of ['Round', 'Absolute value', 'Bucket', 'Standardise', 'Convert units']) await expect(page.getByRole('menuitem', { name: new RegExp(`^${title}`) })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('round to places and up, leaving empty values empty', async ({ page }) => {
  await addStep(page, 'Round');
  await expect(settings(page).getByTestId('expected-type')).toContainText('Number columns');
  await expect(settings(page).getByTestId('expected-type').locator('.ui-type')).toHaveText(['123', '1.5']);
  await chip(page, 'price').click();
  await chip(page, 'id').click();
  await commit(page, 'Decimal places', '2');
  await expect(steps(page)).toHaveText([/Rounded price to 2 decimal places/]);
  await expect(cell(page, 2, 1)).toHaveText('2.68');
  await expect(cell(page, 2, 2)).toHaveText('null');

  await settings(page).getByLabel('Round', { exact: true }).selectOption('up');
  await commit(page, 'Decimal places', '1');
  await expect(steps(page)).toHaveText([/Rounded price up to 1 decimal place$/]);
  await expect(cell(page, 2, 0)).toHaveText('1.1');
  await expect(cell(page, 2, 1)).toHaveText('2.7');
});

test('bucket by custom edges with the labels shown first, then convert units', async ({ page }) => {
  await addStep(page, 'Bucket');
  await chip(page, 'amount').click();
  await settings(page).getByLabel('Buckets', { exact: true }).selectOption('edges');
  await commit(page, 'Edges', '10, 0');
  await expect(settings(page).getByText('List edges from smallest to largest.')).toBeVisible();
  await commit(page, 'Edges', '0, 10');
  await expect(settings(page).getByText('Buckets: under 0; 0 to under 10; 10 and over')).toBeVisible();
  await commit(page, 'New column', 'size');
  await expect(steps(page)).toHaveText([/Bucketed amount into size/]);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', 'id,amount,price,temp_c,length_cm,score,flat,size');
  await expect(cell(page, 7, 0)).toHaveText('under 0');
  await expect(cell(page, 7, 1)).toHaveText('0 to under 10');
  await expect(cell(page, 7, 3)).toHaveText('10 and over');

  await addStep(page, 'Convert units');
  await chip(page, 'temp_c').click();
  await chip(page, 'id').click();
  await settings(page).getByLabel('From', { exact: true }).selectOption('c');
  await expect(settings(page).getByText('Convert to a unit of the same kind.')).toBeVisible();
  await settings(page).getByLabel('To', { exact: true }).selectOption('f');
  await expect(steps(page).nth(1)).toHaveText(/Converted temp_c from Celsius to Fahrenheit/);
  await expect(cell(page, 3, 1)).toHaveText('212.0');
  await expect(cell(page, 3, 3)).toHaveText('98.6');
});

test('a number step given text points at parse numbers', async ({ page }) => {
  await addStep(page, 'Change type');
  await chip(page, 'price').click();
  await settings(page).getByLabel('New type', { exact: true }).selectOption('text');
  await addStep(page, 'Standardise');
  await chip(page, 'id').click();
  await chip(page, 'price').click();
  await expect(settings(page).getByText('price is text. Add a Parse numbers step before this one to read it as numbers.')).toBeVisible();
  // Running it anyway says the same in the step's error.
  await expect(settings(page).getByText(/text where dates or numbers are needed/)).toBeVisible();
});
