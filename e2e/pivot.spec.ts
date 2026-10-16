import { expect, test, type Page } from '@playwright/test';
import { addFiles, cell, fixture, node, openApp } from './helpers/app';

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
const settings = (page: Page) => page.getByTestId('step-settings');
const editor = (page: Page) => page.getByTestId('pivot-editor');
const zone = (page: Page, name: string) => editor(page).getByRole('group', { name, exact: true });

async function addStep(page: Page, title: string) {
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${title}`) }).click();
}

/**
 * Drag a field from the list into a zone. The editor is scrolled into the middle of the inspector first, so the
 * field list and the zones are both in view: otherwise reaching the target scrolls the inspector mid-drag, moving
 * fields and zones out from under the pointer.
 */
async function drag(page: Page, field: string, to: string) {
  await editor(page).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await editor(page).getByRole('button', { name: `Add ${field}` }).dragTo(zone(page, to));
  await expect(zone(page, to).getByRole('button', { name: `${to}: ${field}` })).toBeVisible();
}

/** Open a menu and choose from it with the keyboard only. */
async function byKeyboard(page: Page, trigger: string, item: string) {
  await editor(page).getByRole('button', { name: trigger, exact: true }).focus();
  await page.keyboard.press('Enter');
  await editor(page).getByRole('menuitem', { name: item, exact: true }).focus();
  await page.keyboard.press('Enter');
}

test.use({ viewport: { width: 1280, height: 1400 } });

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('sales.csv')]);
  await node(page, 'sales.csv').click();
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await node(page, 'Transform 1').click();
});

test('pivot by dragging fields into zones; a new value waits for Refresh columns, which reports it', async ({ page }) => {
  // Leave East out first, so March isn't in the data when the pivot is set up.
  await addStep(page, 'Filter rows');
  await settings(page).getByLabel('Condition 1 column', { exact: true }).selectOption('region');
  await settings(page).getByLabel('Condition 1 comparison').selectOption('notEquals');
  await settings(page).getByLabel('Condition 1 value').fill('East');
  await settings(page).getByLabel('Condition 1 value').press('Enter');

  await addStep(page, 'Pivot or group by');
  await expect(editor(page).getByText('Drag a column to Rows or Values.')).toBeVisible();
  await drag(page, 'region', 'Rows');
  await drag(page, 'month', 'Columns');
  await drag(page, 'revenue', 'Values');
  await expect(zone(page, 'Values').getByRole('button', { name: 'Summarise revenue: sum' })).toBeVisible();
  await expect(steps(page).nth(1)).toHaveText(/Pivoted month into columns by region/);
  await expect(editor(page).getByText('Columns for month: 2024-01, 2024-02.')).toBeVisible();
  await expect(cell(page, 0, 0)).toHaveText('North', { timeout: 20_000 });
  await expect(cell(page, 1, 0)).toHaveText('55.5');
  await expect(cell(page, 2, 1)).toHaveText('76.5');
  await expect(cell(page, 3, 0)).toHaveCount(0);

  // Turning the filter off lets East's March sale through. The pivot keeps its columns until refreshed.
  await steps(page).nth(0).click();
  await settings(page).getByRole('switch', { name: 'Enabled' }).click();
  await steps(page).nth(1).click();
  await expect(cell(page, 0, 0)).toHaveText('East');
  await expect(cell(page, 3, 0)).toHaveCount(0);
  await expect(editor(page).getByText('Columns for month: 2024-01, 2024-02.')).toBeVisible();

  await editor(page).getByRole('button', { name: 'Refresh columns' }).click();
  await expect(editor(page).getByRole('status')).toHaveText('Added 2024-03.');
  await expect(cell(page, 3, 0)).toHaveText('40.0');
});

test('group by with the keyboard alone: add fields, move one, change an aggregate, rename a column', async ({ page }) => {
  await addStep(page, 'Pivot or group by');
  await byKeyboard(page, 'Add region', 'Add to rows');
  await byKeyboard(page, 'Add units', 'Add to values');
  await byKeyboard(page, 'Add rep', 'Add to rows');
  await byKeyboard(page, 'Rows: rep', 'Move to values');
  await expect(zone(page, 'Rows').getByRole('button', { name: /^Rows: / })).toHaveText(['region']);
  await byKeyboard(page, 'Summarise rep: count', 'Count distinct');
  await expect(steps(page)).toHaveText([/Grouped by region/], { timeout: 20_000 });
  await expect(cell(page, 0, 0)).toHaveText('East', { timeout: 20_000 });
  await expect(cell(page, 1, 1)).toHaveText('6');
  await expect(cell(page, 2, 1)).toHaveText('2');
  await expect(cell(page, 2, 3)).toHaveText('0');

  await editor(page).getByRole('button', { name: 'Rename columns (2)' }).click();
  await editor(page).getByLabel('sum of units', { exact: true }).fill('units sold');
  await editor(page).getByLabel('sum of units', { exact: true }).press('Enter');

  // A later step sees the summary's columns by their names.
  await addStep(page, 'Sort rows');
  await expect(settings(page).getByLabel('Sort column 1', { exact: true }).locator('option')).toHaveText(['region', 'units sold', 'count distinct of rep'], { timeout: 20_000 });
  await settings(page).getByLabel('Sort column 1', { exact: true }).selectOption('units sold');
  await settings(page).getByLabel('Sort direction 1').selectOption('desc');
  await expect(cell(page, 0, 0)).toHaveText('South');
});
