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
  await expect(formats(page).getByRole('button', { name: 'Use DD/MM/YYYY, reads 100%' })).toBeVisible();
  await expect(formats(page).getByRole('button', { name: 'Use MM/DD/YYYY, reads 100%' })).toBeVisible();

  // With no format chosen, it asks.
  await formats(page).getByRole('button', { name: 'Remove DD/MM/YYYY' }).click();
  await expect(formats(page).getByText('Day and month order is unclear')).toBeVisible();
  await expect(settings(page).getByText('Choose a date format.')).toBeVisible();

  await formats(page).getByRole('button', { name: 'Month first (MM/DD/YYYY)' }).click();
  await expect(formats(page).getByText('Reading the month first')).toBeVisible();
  await expect(steps(page)).toHaveText([/Parsed ambiguous as dates/]);
  await expect(cell(page, 3, 0)).toHaveText('2024-01-02');

  await formats(page).getByRole('button', { name: 'Read day first' }).click();
  await expect(formats(page).getByRole('list', { name: 'Formats tried' }).locator('[data-format]')).toHaveText(['DD/MM/YYYY']);
  await expect(cell(page, 3, 0)).toHaveText('2024-02-01');
});

test('a detected format is offered with its match rate, and your own can be added', async ({ page }) => {
  await only(page, 'textual');
  // The uk format reads none of this column, and says so; the detected one replaces it.
  await expect(formats(page).getByText('reads none of textual')).toBeVisible();
  await formats(page).getByRole('button', { name: 'Use DD Month YYYY, reads 100%' }).click();
  await formats(page).getByRole('button', { name: 'Remove DD/MM/YYYY' }).click();
  await expect(formats(page).getByRole('list', { name: 'Formats tried' }).locator('[data-format]')).toHaveText(['DD Month YYYY']);
  await expect(cell(page, 5, 2)).toHaveText('2024-03-01');

  await formats(page).getByLabel('Add a format').fill('%Y-%m-%d');
  await formats(page).getByLabel('Add a format').press('Enter');
  await expect(formats(page).getByRole('list', { name: 'Formats tried' }).locator('[data-format]')).toHaveText(['DD Month YYYY', 'YYYY-MM-DD']);
});

// #291: engine words on screen: "null" in an empty cell, %d/%m/%Y for a date format, the bundle name in the strip.
test('an empty cell reads empty, and a date format is shown and typed in words, with the code on hover', async ({ page }) => {
  await only(page, 'textual');
  await formats(page).getByRole('button', { name: 'Use DD Month YYYY, reads 100%' }).click();
  const tried = formats(page).getByRole('list', { name: 'Formats tried' }).locator('[data-format]');
  await expect(tried).toHaveText(['DD/MM/YYYY', 'DD Month YYYY']);
  // The code DuckDB reads is one hover away, not the first thing shown.
  await expect(tried.nth(1)).toHaveAttribute('title', '%d %B %Y');
  await expect(formats(page)).not.toContainText(/%[dmYyBb]/);

  // A format typed in words is kept as its code.
  await formats(page).getByLabel('Add a format').fill('YYYY/MM/DD hh:mm');
  await formats(page).getByLabel('Add a format').press('Enter');
  await expect(tried).toHaveText(['DD/MM/YYYY', 'DD Month YYYY', 'YYYY/MM/DD hh:mm']);
  await expect(tried.nth(2)).toHaveAttribute('title', '%Y/%m/%d %H:%M');

  // A value no format reads is an empty cell, which says "empty".
  await formats(page).getByRole('button', { name: 'Remove DD Month YYYY' }).click();
  await expect(cell(page, 5, 0)).toHaveText('empty');
  await expect(page.getByTestId('engine-ready')).toHaveText(/^DuckDB v[\d.]+$/);
});
