import { expect, test, type Page } from '@playwright/test';
import { addFiles, addStep, cell, fixture, node, openApp } from './helpers/app';

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
const settings = (page: Page) => page.getByTestId('step-settings');
const chip = (page: Page, name: string) => settings(page).getByRole('button', { name, exact: true });

async function transformOn(page: Page, file: string) {
  await node(page, file).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await node(page, 'Transform 1').click();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('unpivot quarter columns into rows, with mixed types explained and unpivoted as text', async ({ page }) => {
  await addFiles(page, [fixture('quarters.csv')]);
  await transformOn(page, 'quarters.csv');
  await addStep(page, 'Unpivot columns');
  await expect(settings(page).getByText('Pick at least one column.')).toBeVisible();
  for (const q of ['q1', 'q2', 'q3']) await chip(page, q).click();
  await expect(steps(page)).toHaveText([/Unpivoted q1, q2, q3/]);
  await expect(cell(page, 0, 0)).toHaveText('East', { timeout: 20_000 });
  await expect(cell(page, 2, 0)).toHaveText('q1');
  await expect(cell(page, 3, 0)).toHaveText('10');
  // East has no q3, and empty values are left out, so North's first quarter is the third row.
  await expect(cell(page, 2, 2)).toHaveText('q1');

  await settings(page).getByLabel('Attribute column', { exact: true }).fill('quarter');
  await settings(page).getByLabel('Attribute column', { exact: true }).press('Enter');
  await expect(steps(page)).toHaveText([/Unpivoted q1, q2, q3/]);

  // A text column with the numbers: warned about before it runs, then unpivoted as text.
  await chip(page, 'manager').click();
  await expect(settings(page).getByText(/hold numbers \(q1, q2, q3\) and text \(manager\)/)).toBeVisible();
  await settings(page).getByRole('switch', { name: 'Treat all values as text' }).click();
  await expect(settings(page).getByText(/hold numbers/)).toHaveCount(0);
  await expect(cell(page, 1, 2)).toHaveText('manager', { timeout: 20_000 });
  await expect(cell(page, 2, 2)).toHaveText('Ed');
});

test('transpose a small table, with the first column as headers', async ({ page }) => {
  await addFiles(page, [fixture('quarters.csv')]);
  await transformOn(page, 'quarters.csv');
  await addStep(page, 'Transpose');
  await expect(settings(page).getByTestId('transpose-rows')).toContainText('3 rows become 3 columns.');
  await expect(settings(page).getByText('New columns: column, row 1, row 2, row 3.')).toBeVisible();
  await expect(cell(page, 0, 0)).toHaveText('region', { timeout: 20_000 });
  await expect(cell(page, 1, 0)).toHaveText('East');

  await settings(page).getByRole('switch', { name: 'Use the first column as headers' }).click();
  await expect(steps(page)).toHaveText([/Transposed, with region as headers/]);
  await expect(settings(page).getByText('New columns: column, East, North, South.')).toBeVisible();
  await expect(cell(page, 0, 0)).toHaveText('q1', { timeout: 20_000 });
  await expect(cell(page, 3, 0)).toHaveText('5');
  await expect(cell(page, 1, 3)).toHaveText('Ed');

  await settings(page).getByRole('button', { name: 'Refresh rows' }).click();
  await expect(settings(page).getByRole('status')).toHaveText('No change: still 3 rows.');
});

test('transpose refuses a table with too many rows, saying why', async ({ page }) => {
  const csv = ['id,x', ...Array.from({ length: 1500 }, (_, i) => `${i},${i * 2}`)].join('\n');
  await addFiles(page, [{ name: 'long.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }]);
  await transformOn(page, 'long.csv');
  await addStep(page, 'Transpose');
  await expect(settings(page).getByTestId('transpose-rows')).toContainText('1,500 rows: too many to transpose.');
  await expect(
    settings(page).getByText('The table has 1,500 rows, and transpose makes a column of each, so it only runs on up to 1,000: filter or group the rows first.'),
  ).toBeVisible();
});
