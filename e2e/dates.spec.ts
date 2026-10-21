import { expect, test, type Page } from '@playwright/test';
import { addFiles, addStepNode, cell, fixture, openApp, selectNode } from './helpers/app';

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
const settings = (page: Page) => page.getByTestId('step-settings');
const formats = (page: Page) => page.getByTestId('date-formats');

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('dates.csv')]);
  await selectNode(page, 'dates.csv');
  await addStepNode(page, 'Parse dates');
});

/** Parse `column` instead of the default, uk (the first text column). */
async function only(page: Page, column: string) {
  const chip = (name: string) => settings(page).getByRole('button', { name, exact: true });
  await expect(chip('uk')).toHaveAttribute('aria-pressed', 'true');
  await chip(column).click();
  await expect(chip(column)).toHaveAttribute('aria-pressed', 'true');
  await chip('uk').click();
  await expect(chip('uk')).toHaveAttribute('aria-pressed', 'false');
}

test('an ambiguous day and month order is asked, never guessed', async ({ page }) => {
  await only(page, 'ambiguous');
  // The format picked for uk reads the day first; on this column that's a choice, so it says so.
  await expect(formats(page).getByText('Reading the day first')).toBeVisible();
  await expect(formats(page).getByRole('button', { name: 'Use %d/%m/%Y, reads 100%' })).toBeVisible();
  await expect(formats(page).getByRole('button', { name: 'Use %m/%d/%Y, reads 100%' })).toBeVisible();

  // With no format chosen, it asks.
  await formats(page).getByRole('button', { name: 'Remove %d/%m/%Y' }).click();
  await expect(formats(page).getByText('Day and month order is unclear')).toBeVisible();
  await expect(settings(page).getByText('Choose a date format.')).toBeVisible();

  await formats(page).getByRole('button', { name: 'Month first (MM/DD/YYYY)' }).click();
  await expect(formats(page).getByText('Reading the month first')).toBeVisible();
  await expect(steps(page)).toHaveText([/Parsed ambiguous as dates/]);
  await expect(cell(page, 3, 0)).toHaveText('2024-01-02');

  await formats(page).getByRole('button', { name: 'Read day first' }).click();
  await expect(formats(page).getByRole('list', { name: 'Formats tried' }).locator('code')).toHaveText(['%d/%m/%Y']);
  await expect(cell(page, 3, 0)).toHaveText('2024-02-01');
});

test('a detected format is offered with its match rate, and your own can be added', async ({ page }) => {
  await only(page, 'textual');
  // The uk format reads none of this column, and says so; the detected one replaces it.
  await expect(formats(page).getByText('reads none of textual')).toBeVisible();
  await formats(page).getByRole('button', { name: 'Use %d %B %Y, reads 100%' }).click();
  await formats(page).getByRole('button', { name: 'Remove %d/%m/%Y' }).click();
  await expect(formats(page).getByRole('list', { name: 'Formats tried' }).locator('code')).toHaveText(['%d %B %Y']);
  await expect(cell(page, 5, 2)).toHaveText('2024-03-01');

  await formats(page).getByLabel('Add a format').fill('%Y-%m-%d');
  await formats(page).getByLabel('Add a format').press('Enter');
  await expect(formats(page).getByRole('list', { name: 'Formats tried' }).locator('code')).toHaveText(['%d %B %Y', '%Y-%m-%d']);
});
