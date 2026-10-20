import { expect, test, type Page } from '@playwright/test';
import { addFiles, addStep, addStepNode, cell, expectRows, fixture, node, openApp, selectNode } from './helpers/app';

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
const settings = (page: Page) => page.getByTestId('step-settings');

/** A step from the Add menu, as a Transform after `source`. */
async function stepAfter(page: Page, source: string, title: string) {
  await selectNode(page, source);
  await addStepNode(page, title);
}

test('filter, sort and fill down', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('gaps.csv')]);
  await stepAfter(page, 'gaps.csv', 'Fill down or up');
  await settings(page).getByRole('button', { name: 'region', exact: true }).click();
  await expect(steps(page)).toHaveText([/Filled region down/]);
  await expect(cell(page, 0, 2)).toHaveText('North');

  await addStep(page, 'Filter rows');
  await settings(page).getByLabel('Condition 1 column', { exact: true }).selectOption('sales');
  await settings(page).getByLabel('Condition 1 comparison').selectOption('greater');
  await expect(settings(page).getByText('Give a value to compare with.')).toBeVisible();
  await settings(page).getByLabel('Condition 1 value').fill('8');
  await settings(page).getByLabel('Condition 1 value').press('Enter');
  await expect(steps(page).nth(1)).toHaveText(/Kept rows where sales is more than 8/);
  await expectRows(page, 2);

  await addStep(page, 'Sort rows');
  await settings(page).getByLabel('Sort column 1', { exact: true }).selectOption('sales');
  await settings(page).getByLabel('Sort direction 1').selectOption('desc');
  await expect(steps(page).nth(2)).toHaveText(/Sorted by sales \(descending\)/);
  await expect(cell(page, 2, 0)).toHaveText('12');
  await expect(cell(page, 0, 0)).toHaveText('North');
});

test('remove title rows, then use the first row as headers', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('title-rows.csv')]);
  // Click the node once it has settled: a click while it is still being laid out can land on the pane instead.
  await expect(node(page, 'title-rows.csv')).toHaveAttribute('data-status', /ok|error/, { timeout: 20_000 });
  await selectNode(page, 'title-rows.csv');
  await page.getByText('First row is the header').click();
  await stepAfter(page, 'title-rows.csv', 'Remove top or bottom rows');
  await settings(page).getByLabel('Rows').fill('2');
  await settings(page).getByLabel('Rows').press('Enter');
  await expect(steps(page)).toHaveText([/Removed top 2 rows/]);
  await expect(cell(page, 0, 0)).toHaveText('Region');

  await addStep(page, 'Use first row as headers');
  await expect(steps(page).nth(1)).toHaveText(/Promoted the first row to headers/);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', 'Region,Quarter,Total');
  await expectRows(page, 2);
  await expect(cell(page, 2, 0)).toHaveText('120');
});
