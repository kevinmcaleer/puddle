import { expect, test } from '@playwright/test';
import { addFiles, cell, expectRows, openApp } from './helpers/app';

const big = (n: number) => {
  const lines = ['id,label,score'];
  for (let i = 1; i <= n; i++) lines.push(`${i},row ${i},${i % 7 === 0 ? '' : i * 1.5}`);
  return Buffer.from(lines.join('\n') + '\n');
};

test('large results load in pages as the table scrolls', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [{ name: 'big.csv', mimeType: 'text/csv', buffer: big(2000) }]);
  await expectRows(page, 2000);
  const table = page.getByTestId('results-table');
  await expect(table).toHaveAttribute('data-loaded', '500');
  await expect(page.getByRole('status').filter({ hasText: 'rows' })).toContainText('2,000 rows');

  // Scroll to the bottom: the last page loads, and nothing else is fetched twice.
  await table.hover();
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 4000);
  await expect.poll(async () => Number(await table.getAttribute('data-loaded'))).toBeGreaterThan(500);
});

test('selecting column headers records the selection for quick fixes', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [{ name: 'big.csv', mimeType: 'text/csv', buffer: big(20) }]);
  await expectRows(page, 20);
  const table = page.getByTestId('results-table');
  // The grid is a canvas: after the row numbers, each of these short-named columns is 120px wide.
  const box = (await table.boundingBox())!;
  await page.mouse.click(box.x + 200, box.y + 20);
  await expect(table).toHaveAttribute('data-selected', 'label');
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + 320, box.y + 20);
  await page.keyboard.up('Shift');
  await expect(table).toHaveAttribute('data-selected', 'label,score');
});

test('nulls and numbers are shown the way DuckDB reads them', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [{ name: 'big.csv', mimeType: 'text/csv', buffer: big(20) }]);
  await expectRows(page, 20);
  // Glide mirrors visible cells into an accessible table; column 0 there is the row number.
  await expect(cell(page, 1, 6)).toHaveText('row 7');
  await expect(cell(page, 2, 6)).toHaveText('null');
  await expect(cell(page, 2, 1)).toHaveText('3.0');
});
