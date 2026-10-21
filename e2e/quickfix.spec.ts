import { expect, test, type Page } from '@playwright/test';
import { addFiles, cell, expectRows, fixture, node, openApp, stackSteps } from './helpers/app';

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
const fixes = (page: Page) => page.getByRole('toolbar', { name: 'Quick fixes' });

/**
 * Click column headers in the results grid (a canvas). messy.csv's names are short, so after the row numbers
 * every column is 120px wide; Shift adds to the selection.
 */
async function selectColumns(page: Page, ...indexes: number[]) {
  const table = page.getByTestId('results-table');
  const box = (await table.boundingBox())!;
  for (const [k, i] of indexes.entries()) {
    if (k) await page.keyboard.down('Shift');
    await page.mouse.click(box.x + 100 + 120 * i, box.y + 20);
    if (k) await page.keyboard.up('Shift');
  }
  // The quick fixes follow the selection a moment after the click (Firefox is slower): wait until they list as many
  // columns as were clicked before a fix is picked, so the fix lands on the right columns.
  await expect(page.getByTestId('quick-fixes')).toHaveAttribute('data-columns', new RegExp(`^([^,]+,){${indexes.length - 1}}[^,]+$`));
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('messy.csv')]);
  await expectRows(page, 5);
});

test('a fix on a viewed source adds one step for every selected column, in a new Transform, and the next fix in a Transform of its own', async ({ page }) => {
  await expect(fixes(page)).toHaveCount(0);
  await selectColumns(page, 1, 2);
  await expect(page.getByTestId('quick-fixes')).toHaveAttribute('data-columns', 'name,city');
  await fixes(page).getByRole('button', { name: 'Trim' }).click();

  await expect(node(page, 'Transform 1')).toBeVisible();
  await expect(page.getByTestId('wire-messy.csv->Transform 1')).toBeAttached();
  await expect(steps(page)).toHaveText([/Trimmed name, city/]);
  await expect(page.getByTestId('results-title')).toHaveText('Transform 1 · step 1');
  await expect(cell(page, 2, 1)).toHaveText('new york');

  // Each step is a node of its own: the next fix lands in a new Transform after this one.
  await selectColumns(page, 1, 2);
  await fixes(page).getByRole('button', { name: 'Case' }).click();
  await page.getByRole('menuitem', { name: 'Title Case' }).click();
  await expect(node(page, 'Transform 2')).toBeVisible();
  await expect(page.getByTestId('wire-Transform 1->Transform 2')).toBeAttached();
  await expect(steps(page)).toHaveText([/Changed name, city to title case/]);
  await expect(page.getByTestId('results-title')).toHaveText('Transform 2 · step 1');
  await expect(cell(page, 2, 0)).toHaveText('London');

  // With the setting off, a fix lands on the viewed node, after the viewed step.
  await stackSteps(page);
  await selectColumns(page, 1);
  await fixes(page).getByRole('button', { name: 'Collapse spaces' }).click();
  await expect(node(page, 'Transform 3')).toHaveCount(0);
  await expect(steps(page)).toHaveText([/Changed name, city to title case/, /Collapsed spaces in name/]);
  await expect(cell(page, 1, 0)).toHaveText('Ada Lovelace');
});

test('parse numbers, parse dates, strip non-printing characters, empty to null and remove duplicates', async ({ page }) => {
  // Stacked into one Transform, so the step list shows them all.
  await stackSteps(page);
  await selectColumns(page, 3);
  await fixes(page).getByRole('button', { name: 'Parse numbers' }).click();
  await expect(steps(page)).toHaveText([/Parsed numbers in price/]);
  await expect(cell(page, 3, 0)).toHaveText('1234.5');
  await expect(cell(page, 3, 2)).toHaveText('-12.0');

  await selectColumns(page, 4);
  await fixes(page).getByRole('button', { name: 'Parse dates' }).click();
  await expect(steps(page).nth(1)).toHaveText(/Parsed joined as dates/);
  await expect(cell(page, 4, 0)).toHaveText('2024-01-31');

  // Row 3's name hides a zero-width space; row 4's is only spaces.
  await selectColumns(page, 1);
  await fixes(page).getByRole('button', { name: 'Non-printing' }).click();
  await expect(steps(page).nth(2)).toHaveText(/Removed non-printing characters from name/);
  await expect(cell(page, 1, 2)).toHaveText('edsgerdijkstra');

  await selectColumns(page, 1);
  await fixes(page).getByRole('button', { name: 'Empty to null' }).click();
  await expect(steps(page).nth(3)).toHaveText(/Made empty text in name empty values/);
  await expect(cell(page, 1, 3)).toHaveText('null');

  await selectColumns(page, 0, 1);
  await fixes(page).getByRole('button', { name: 'Remove duplicates' }).click();
  await expect(steps(page).nth(4)).toHaveText(/Removed duplicate rows by id, name/);
  await expectRows(page, 4);
});
