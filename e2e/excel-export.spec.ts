import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { parseWorkbook, readSheet } from '../src/excel/read';
import { addFiles, expectRows, fixture, node, openApp } from './helpers/app';

const settings = (page: Page) => page.getByTestId('output-settings');

/** Add a file, then an Output node after it, and select the Output. */
async function toOutput(page: Page, file: Parameters<typeof addFiles>[1][number], source: string) {
  await addFiles(page, [file] as Parameters<typeof addFiles>[1]);
  await expect(node(page, source)).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });
  await node(page, source).click();
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });
  await node(page, 'Output 1').click();
}

test('an Output node exports an Excel workbook that reads back with the same rows, columns and types', async ({ page }) => {
  await openApp(page);
  await toOutput(page, fixture('sales.xlsx'), 'sales.xlsx');
  await expectRows(page, 4);

  await page.getByLabel('Format').selectOption('xlsx');
  await expect(settings(page)).toContainText('Saved as Output 1.xlsx.');
  await expect(page.getByLabel('Sheet name')).toHaveAttribute('placeholder', 'Output 1');
  await page.getByLabel('Sheet name').fill('Sales 2026');
  await page.getByLabel('Sheet name').press('Enter');
  await expect(page.getByRole('switch', { name: 'Include column names' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('switch', { name: 'Freeze the header row' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('sheet-row-limit')).toHaveCount(0);

  const download = page.waitForEvent('download');
  await settings(page).getByRole('button', { name: 'Export Excel' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Output 1.xlsx');
  const bytes = new Uint8Array(Buffer.concat(await (await file.createReadStream()).toArray()));
  await expect(page.getByTestId('canvas-notice')).toContainText('Exported Output 1.xlsx (4 rows).');
  await expect(page.getByTestId('export-log')).toContainText('Output 1.xlsx · 4 rows');

  const wb = parseWorkbook(bytes);
  expect(wb.SheetNames).toEqual(['Sales 2026']);
  const back = readSheet(wb);
  expect(back).toMatchObject({ headerRow: 1, rows: 4 });
  const original = readSheet(parseWorkbook(new Uint8Array((await import('node:fs')).readFileSync(fixture('sales.xlsx')))));
  expect(back.columns.map((c) => [c.name, c.type])).toEqual(original.columns.map((c) => [c.name, c.type]));
  expect(back.columns.map((c) => c.values)).toEqual(original.columns.map((c) => c.values));
  // The header row is frozen.
  const sheet = XLSX.CFB.find(XLSX.CFB.read(bytes, { type: 'array' }), '/xl/worksheets/sheet1.xml') as { content: Uint8Array };
  expect(new TextDecoder().decode(sheet.content)).toContain('state="frozen"');
});

test('above Excel’s row limit the export doesn’t run, says why and offers CSV or Parquet', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  // One row more than a sheet holds below its header.
  const rows = 1_048_576;
  const csv = Buffer.from('n\n' + Array.from({ length: rows }, (_, i) => i).join('\n') + '\n');
  await toOutput(page, { name: 'big.csv', mimeType: 'text/csv', buffer: csv }, 'big.csv');
  await expectRows(page, rows);

  await page.getByLabel('Format').selectOption('xlsx');
  const limit = page.getByTestId('sheet-row-limit');
  await expect(limit).toContainText('Too many rows for Excel');
  await expect(limit).toContainText('This output has 1,048,576 rows; an Excel sheet holds at most 1,048,575 below its header.');

  let downloads = 0;
  page.on('download', () => downloads++);
  await settings(page).getByRole('button', { name: 'Export Excel' }).click();
  await expect(page.getByTestId('canvas-notice')).toContainText('This output has 1,048,576 rows; an Excel sheet holds at most 1,048,575 below its header. Export it as CSV or Parquet instead, which have no row limit.');
  await expect(page.getByTestId('export-log')).toHaveCount(0);
  expect(downloads).toBe(0);

  // Without the header row there is room for exactly this many.
  await page.getByRole('switch', { name: 'Include column names' }).click();
  await expect(limit).toHaveCount(0);
  await page.getByRole('switch', { name: 'Include column names' }).click();
  await expect(limit).toBeVisible();

  await limit.getByRole('button', { name: 'Use CSV' }).click();
  await expect(page.getByLabel('Format')).toHaveValue('csv');
  await expect(limit).toHaveCount(0);
  await expect(settings(page).getByRole('button', { name: 'Export CSV' })).toBeEnabled();
});
