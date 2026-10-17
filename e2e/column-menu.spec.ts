import { expect, test, type Page } from '@playwright/test';
import { addFiles, cell, expectRows, fixture, node, openApp } from './helpers/app';

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
const menu = (page: Page) => page.getByTestId('context-menu');

/**
 * Right-click in the results grid (a canvas). messy.csv's columns are each 120px wide after the row numbers; the
 * header is 52px tall and each row 28px.
 */
async function rightClick(page: Page, col: number, row?: number) {
  const box = (await page.getByTestId('results-table').boundingBox())!;
  await page.mouse.click(box.x + 100 + 120 * col, row == null ? box.y + 20 : box.y + 52 + 28 * row + 14, { button: 'right' });
  await expect(menu(page)).toBeVisible();
}

test('the column menu replaces values, removes matching rows and can add each step as a node', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('messy.csv')]);
  await expectRows(page, 5);

  // Replace values from a header: empty cities become the word "empty".
  await rightClick(page, 2);
  await expect(menu(page)).toHaveAccessibleName('Actions for city');
  await menu(page).getByRole('menuitem', { name: 'Replace values…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replace values in city' });
  await expect(dialog.getByLabel('Find')).toHaveValue('null');
  await expect(dialog.getByRole('textbox', { name: 'Replace with' })).toHaveValue('empty');
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(node(page, 'Transform 1')).toBeVisible();
  await expect(steps(page)).toHaveText([/Replaced empty values with "empty" in city/]);
  await expect(cell(page, 2, 3)).toHaveText('empty');

  // From a cell: remove the rows with that value.
  await rightClick(page, 2, 2);
  await menu(page).getByRole('menuitem', { name: 'Remove rows where it is “Paris”' }).click();
  await expect(steps(page).nth(1)).toHaveText(/Removed rows where city is Paris/);
  await expectRows(page, 3);

  // With each step as a node, the next one goes in a Transform of its own after this one.
  await rightClick(page, 1);
  await menu(page).getByRole('menuitemcheckbox', { name: 'Add each step as a new node' }).click();
  await rightClick(page, 1);
  await expect(menu(page).getByRole('menuitemcheckbox', { name: 'Add each step as a new node' })).toHaveAttribute('aria-checked', 'true');
  await menu(page).getByRole('menuitem', { name: 'Text' }).hover();
  await menu(page).getByRole('menu', { name: 'Text' }).getByRole('menuitem', { name: 'UPPER CASE' }).click();
  await expect(node(page, 'Transform 2')).toBeVisible();
  await expect(page.getByTestId('wire-Transform 1->Transform 2')).toBeAttached();
  await expect(steps(page)).toHaveText([/Changed name to upper case/]);
  await expect(page.getByTestId('results-title')).toHaveText('Transform 2 · step 1');
});

test('the column menu keeps only the rows whose value repeats', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('messy.csv')]);
  await expectRows(page, 5);

  // messy.csv repeats id 3; both copies stay and the rest go.
  await rightClick(page, 0);
  await menu(page).getByRole('menuitem', { name: 'Keep duplicates' }).click();
  await expect(steps(page)).toHaveText([/Kept only duplicate rows by id/]);
  await expectRows(page, 2);
  await expect(cell(page, 0, 0)).toHaveText('3');
  await expect(cell(page, 0, 1)).toHaveText('3');
});

test('the column menu groups by a column, summarising a field two ways, and pivots a column into columns', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('sales.csv')]);
  await expectRows(page, 8);
  const editor = page.getByTestId('pivot-editor');
  const choose = async (trigger: string, item: string) => {
    await editor.getByRole('button', { name: trigger, exact: true }).click();
    await editor.getByRole('menuitem', { name: item, exact: true }).click();
  };

  // Group by region opens the editor on the new step; revenue goes into Values twice, as a sum and an average.
  await rightClick(page, 0);
  await menu(page).getByRole('menuitem', { name: 'Group by this column…' }).click();
  await expect(steps(page)).toHaveText([/Grouped by region/]);
  await choose('Add revenue', 'Add to values');
  await choose('Add revenue', 'Add to values');
  await choose('Summarise revenue: count', 'Average');
  await expect(editor.getByRole('button', { name: /^Summarise revenue/ })).toHaveText(['sum', 'average']);
  await expect(cell(page, 0, 1)).toHaveText('North', { timeout: 20_000 });
  await expect(cell(page, 1, 1)).toHaveText('75.5');
  await expect(cell(page, 2, 0)).toHaveText('40.0');

  // Pivot into columns reads month's values first, so its counts show at once.
  await page.getByRole('button', { name: 'Delete step' }).click();
  await expectRows(page, 8);
  await rightClick(page, 1);
  await menu(page).getByRole('menuitem', { name: 'Pivot into columns…' }).click();
  await expect(steps(page)).toHaveText([/Pivoted month into columns/]);
  await expect(editor.getByText('Columns for month: 2024-01, 2024-02, 2024-03.')).toBeVisible();
  await expect(cell(page, 0, 0)).toHaveText('3', { timeout: 20_000 });
  await expect(cell(page, 2, 0)).toHaveText('1');
});
