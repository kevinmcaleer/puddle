import { expect, test, type Page } from '@playwright/test';
import { addFiles, addStep, cell, fixture, node, openApp, saved } from './helpers/app';

// The browser's own locale is fixed for every test (playwright.config.ts); these tests also pick locales themselves.

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
const settings = (page: Page) => page.getByTestId('step-settings');
const formats = (page: Page) => page.getByTestId('date-formats');
const chip = (page: Page, name: string) => settings(page).getByRole('button', { name, exact: true });

/** A Transform after `file`'s source, selected and viewed. */
async function transformOf(page: Page, file: string) {
  await addFiles(page, [fixture(file)]);
  await node(page, file).click();
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await node(page, 'Transform 1').click();
}

/** Pick exactly these columns in the step's Columns field. */
async function onlyColumns(page: Page, keep: string[], all: string[]) {
  for (const c of all) {
    const pressed = (await chip(page, c).getAttribute('aria-pressed')) === 'true';
    if (pressed !== keep.includes(c)) await chip(page, c).click();
    await expect(chip(page, c)).toHaveAttribute('aria-pressed', keep.includes(c) ? 'true' : 'false');
  }
}

/** Click empty canvas, so the inspector shows the project and display settings. */
async function deselect(page: Page) {
  const pane = page.locator('.react-flow__pane');
  const box = (await pane.boundingBox())!;
  await pane.click({ position: { x: box.width - 40, y: 20 } });
  await expect(page.getByTestId('display-settings')).toBeVisible();
}

/** Click a column header in the grid canvas. */
async function selectColumn(page: Page, x: number) {
  const box = (await page.getByTestId('results-table').boundingBox())!;
  await page.mouse.click(box.x + x, box.y + 20);
}

test('a German parse numbers step reads 1.234,56 as 1234.56, and the display locale changes only how it looks', async ({ page }) => {
  await openApp(page);
  await transformOf(page, 'locales.csv');
  await addStep(page, 'Parse numbers');
  await onlyColumns(page, ['de_number'], ['de_number', 'us_number', 'de_date', 'de_short', 'fr_date', 'es_date']);
  // The project's locale (English (UK)) is where a new step starts.
  await expect(settings(page).getByLabel('Locale')).toHaveValue('en-GB');
  await settings(page).getByLabel('Locale').selectOption({ label: 'German (1.234,56)' });
  await expect(settings(page).getByLabel('Decimal mark')).toHaveCount(0);
  await expect(steps(page)).toHaveText([/Parsed numbers in de_number \(German\)/]);
  await expect(cell(page, 0, 0)).toHaveText('1234.56');
  await expect(cell(page, 0, 1)).toHaveText('-7.5');
  await expect(cell(page, 0, 2)).toHaveText('-12.0');
  await expect.poll(async () => JSON.stringify((await saved(page))?.nodes)).toContain('"locale":"de-DE"');

  // Shown in English (UK), the browser's language here.
  await selectColumn(page, 60);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-selected', 'de_number');
  await expect(page.getByTestId('column-profile')).toHaveText('de_number · about 3 distinct · -12.0 to 1,234.56 · 0% empty');

  await deselect(page);
  // Browsers join a date and its time in their own words (a comma, or "um"), so only the parts are pinned.
  await expect(page.getByTestId('display-example')).toHaveText(/^1,234,567\.89 · 31\/12\/2026\D+14:05:09$/);
  await page.getByLabel('Show numbers and dates as').selectOption({ label: 'German' });
  await expect(page.getByTestId('display-example')).toHaveText(/^1\.234\.567,89 · 31\.12\.2026\D+14:05:09$/);
  await expect(page.getByTestId('column-profile')).toHaveText('de_number · about 3 distinct · -12,0 to 1.234,56 · 0% empty');
  await page.getByLabel('Show dates').selectOption({ label: 'As ISO 8601 (2026-12-31)' });
  await expect(page.getByTestId('display-example')).toHaveText('1.234.567,89 · 2026-12-31 14:05:09');

  // What the values are hasn't changed, nor has the project: the display locale is this device's alone.
  await expect(cell(page, 0, 0)).toHaveText('1234.56');
  expect((await saved(page))?.settings).toEqual({ sampleThresholdRows: 5_000_000, locale: 'en-GB', defaultDateFormats: [] });

  // It's remembered on this device.
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByLabel('Show numbers and dates as')).toHaveValue('de-DE');
  await expect(page.getByTestId('display-example')).toHaveText('1.234.567,89 · 2026-12-31 14:05:09');
});

test('a parse dates step reads month names in its locale', async ({ page }) => {
  await openApp(page);
  await transformOf(page, 'locales.csv');
  await addStep(page, 'Parse dates');
  await onlyColumns(page, ['de_date'], ['de_number', 'us_number', 'de_date', 'de_short', 'fr_date', 'es_date']);
  await expect(formats(page).getByText('No format reads de_date')).toBeVisible();
  await settings(page).getByLabel('Locale').selectOption({ label: 'German (day first)' });
  await formats(page).getByRole('button', { name: 'Use %d. %B %Y, reads 100%' }).click();
  await expect(steps(page)).toHaveText([/Parsed de_date as dates/]);
  await expect(cell(page, 2, 0)).toHaveText('2026-12-31');
  await expect(cell(page, 2, 1)).toHaveText('2026-03-01');
});

test('dates that read either way follow the parse dates step’s locale', async ({ page }) => {
  await openApp(page);
  await transformOf(page, 'dates.csv');
  await addStep(page, 'Parse dates');
  await onlyColumns(page, ['ambiguous'], ['uk', 'us', 'ambiguous', 'mixed', 'textual']);
  await formats(page).getByRole('button', { name: 'Remove %d/%m/%Y' }).click();
  // Without a locale the order is asked, as ever.
  await expect(formats(page).getByText('Day and month order is unclear')).toBeVisible();

  await settings(page).getByLabel('Locale').selectOption({ label: 'English (US) (month first)' });
  await expect(formats(page).getByRole('list', { name: 'Formats tried' }).locator('code')).toHaveText(['%m/%d/%Y']);
  await expect(formats(page).getByText('Reading the month first')).toBeVisible();
  await expect(formats(page).getByText(/this is the order English \(US\) uses/)).toBeVisible();
  await expect(cell(page, 3, 0)).toHaveText('2024-01-02');

  await settings(page).getByLabel('Locale').selectOption({ label: 'English (UK) (day first)' });
  await expect(formats(page).getByRole('list', { name: 'Formats tried' }).locator('code')).toHaveText(['%d/%m/%Y']);
  await expect(formats(page).getByText('Reading the day first')).toBeVisible();
  await expect(cell(page, 3, 0)).toHaveText('2024-02-01');

  // A hand-picked order still stands under the same locale.
  await formats(page).getByRole('button', { name: 'Read month first' }).click();
  await expect(formats(page).getByRole('list', { name: 'Formats tried' }).locator('code')).toHaveText(['%m/%d/%Y']);
  await expect(formats(page).getByText(/check this is the order the data uses/)).toBeVisible();
  await expect(cell(page, 3, 0)).toHaveText('2024-01-02');
});
