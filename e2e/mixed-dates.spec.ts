import { expect, test, type Page } from '@playwright/test';
import { cell, expectRows, node, openApp } from './helpers/app';

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
const fixes = (page: Page) => page.getByRole('toolbar', { name: 'Quick fixes' });
const formats = (page: Page) => page.getByTestId('date-formats');

test('parse dates reads a column written in several formats, the day first because its values say so', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Try a sample' }).click();
  await page.getByRole('dialog', { name: 'Try a sample' }).getByTestId('sample-sales').click();
  await expect(node(page, 'sales.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expectRows(page, 72);

  // order_date is the second column of the results grid (a canvas), after the row numbers and order_id.
  const box = (await page.getByTestId('results-table').boundingBox())!;
  await page.mouse.click(box.x + 220, box.y + 20);
  await expect(page.getByTestId('quick-fixes')).toHaveAttribute('data-columns', 'order_date');
  await fixes(page).getByRole('button', { name: 'Parse dates' }).click();

  await expect(steps(page)).toHaveText([/Parsed order_date as dates/]);
  // 2024-05-28, 24/01/2024, 16 Feb 2024 and April 28, 2024 all read.
  await expect(cell(page, 1, 0)).toHaveText('2024-05-28');
  await expect(cell(page, 1, 1)).toHaveText('2024-01-24');
  await expect(cell(page, 1, 2)).toHaveText('2024-02-16');
  await expect(cell(page, 1, 5)).toHaveText('2024-04-28');

  await steps(page).first().click();
  await expect(formats(page).getByRole('list', { name: 'Formats tried' }).locator('code')).toHaveText(['%Y-%m-%d', '%d/%m/%Y', '%d %b %Y', '%B %d, %Y']);
  await expect(formats(page).getByText('Reading the day first')).toBeVisible();
  await expect(formats(page).getByText(/can only be read this way/)).toBeVisible();
  await expect(formats(page).getByText(/fit none of these formats/)).toHaveCount(0);
});
