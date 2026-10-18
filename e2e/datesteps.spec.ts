import { expect, test, type Page } from '@playwright/test';
import { addFiles, addStep, addStepNode, cell, fixture, node, openApp } from './helpers/app';

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
const settings = (page: Page) => page.getByTestId('step-settings');
const chip = (page: Page, name: string) => settings(page).getByRole('button', { name, exact: true });

async function commit(page: Page, label: string, value: string) {
  await settings(page).getByLabel(label, { exact: true }).fill(value);
  await settings(page).getByLabel(label, { exact: true }).press('Enter');
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('periods.csv')]);
  await node(page, 'periods.csv').click();
});

test('format dates as text with a live example, then parse them back', async ({ page }) => {
  await addStepNode(page, 'Format dates as text');
  // Starts on the first date column, and shows what the format makes before it runs.
  await expect(chip(page, 'start')).toHaveAttribute('aria-pressed', 'true');
  await expect(settings(page).getByText('Friday 1 March 2024 at 14:05:09 becomes 01/03/2024')).toBeVisible();
  await commit(page, 'Format', '%d %B %Y');
  await expect(settings(page).getByText('becomes 01 March 2024')).toBeVisible();
  await expect(steps(page)).toHaveText([/Formatted start as %d %B %Y/]);
  await expect(cell(page, 1, 0)).toHaveText('31 January 2024');
  await expect(cell(page, 1, 2)).toHaveText('null');

  // Parse dates finds the same format on the text and reads it back.
  await addStep(page, 'Parse dates');
  await expect(page.getByTestId('date-formats').getByRole('list', { name: 'Formats tried' }).locator('code')).toHaveText(['%d %B %Y']);
  await expect(steps(page)).toHaveText([/Formatted start/, /Parsed start as dates/]);
  await expect(cell(page, 1, 0)).toHaveText('2024-01-31');
  await expect(cell(page, 1, 3)).toHaveText('2024-12-30');
});

test('extract a part, add time and truncate, with text columns pointed at parse dates', async ({ page }) => {
  await addStepNode(page, 'Extract date part');
  await expect(settings(page).getByTestId('expected-type')).toHaveText('Date or date and time columns');
  await chip(page, 'label').click();
  await expect(settings(page).getByText('label is text. Add a Parse dates step before this one to read it as dates.')).toBeVisible();
  await chip(page, 'label').click();
  await expect(settings(page).getByText(/is text\./)).toHaveCount(0);
  await settings(page).getByLabel('Part', { exact: true }).selectOption('weekdayName');
  await expect(steps(page)).toHaveText([/Extracted day name from start/]);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', 'id,start,finish,stamp,months,label,start_weekday_name');
  await expect(cell(page, 6, 0)).toHaveText('Wednesday');

  await addStep(page, 'Add or subtract time');
  await settings(page).getByLabel('Amount', { exact: true }).selectOption('column');
  await expect(settings(page).locator('#step-amountColumn').getByRole('button', { name: 'id', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await settings(page).locator('#step-amountColumn').getByRole('button', { name: 'months', exact: true }).click();
  await settings(page).getByLabel('Unit', { exact: true }).selectOption('months');
  await expect(steps(page).nth(1)).toHaveText(/Added the months in months to start/);
  await expect(cell(page, 1, 0)).toHaveText('2024-02-29');
  await expect(cell(page, 1, 1)).toHaveText('2024-01-15');

  await addStep(page, 'Truncate dates');
  await settings(page).getByLabel('To the start of the', { exact: true }).selectOption('quarter');
  await expect(steps(page).nth(2)).toHaveText(/Truncated start to the quarter/);
  await expect(cell(page, 1, 0)).toHaveText('2024-01-01');
  await expect(cell(page, 1, 2)).toHaveText('null');
});

test('time between two dates in a chosen unit', async ({ page }) => {
  await addStepNode(page, 'Time between dates');
  await expect(settings(page).locator('#step-start').getByRole('button', { name: 'start', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await settings(page).locator('#step-end').getByRole('button', { name: 'stamp', exact: true }).click();
  await settings(page).getByLabel('In', { exact: true }).selectOption('hours');
  await commit(page, 'New column', 'gap');
  await expect(steps(page)).toHaveText([/Added hours from start to stamp as gap/]);
  await expect(cell(page, 6, 0)).toHaveText('9');
  await expect(cell(page, 6, 1)).toHaveText('71');
  await expect(cell(page, 6, 2)).toHaveText('null');
});
