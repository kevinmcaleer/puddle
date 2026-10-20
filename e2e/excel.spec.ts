import { expect, test, type Page } from '@playwright/test';
import { addFiles, cell, columnsOf, expectRows, fixture, node, openApp } from './helpers/app';

const columns = (page: Page) => page.getByTestId('inspector-columns').locator('.ui-col');
const types = (page: Page) => page.getByTestId('inspector-columns').locator('.ui-type');

test('an Excel workbook loads its first sheet, past the title row, with Excel types and generated header names', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('sales.xlsx')]);
  await expect(node(page, 'sales.xlsx')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(page.getByTestId('results-title')).toHaveText('sales.xlsx');
  await expectRows(page, 4);
  expect(await columnsOf(page, 'sales.xlsx')).toEqual(['Region', 'Order date', 'Amount', 'Paid', 'Notes', 'Contact', 'Contact_2', 'Column H']);
  await expect(types(page)).toHaveCount(8);
  expect(await types(page).evaluateAll((els) => els.map((e) => e.getAttribute('title')))).toEqual(['VARCHAR', 'DATE', 'DOUBLE', 'BOOLEAN', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'INTEGER']);
  await expect(cell(page, 0, 0)).toHaveText('North');

  // The inspector lists every sheet with its size, and shows the detected header row.
  await expect(page.getByTestId('inspector-source')).toContainText('Source · Excel');
  await expect(page.getByLabel('Sheet').locator('option')).toHaveText(['Sales (7 rows, 8 columns)', 'Visits (3 rows, 4 columns)', 'Empty (empty)']);
  await expect(page.getByLabel('Header row', { exact: true })).toHaveAttribute('placeholder', 'Detect (row 3)');
  await expect(page.getByTestId('excel-large')).toHaveCount(0);
});

test('switching sheet updates the preview and is one undo step', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('sales.xlsx')]);
  expect(await columnsOf(page, 'sales.xlsx')).toHaveLength(8);

  await page.getByLabel('Sheet').selectOption('Visits');
  await expect(columns(page)).toHaveText(['Visitor', 'Arrived', 'Count', 'Mixed']);
  await expectRows(page, 2);
  await expect(cell(page, 0, 0)).toHaveText('Ann');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Sheet')).toHaveValue('Sales');
  await expect(columns(page)).toHaveText(['Region', 'Order date', 'Amount', 'Paid', 'Notes', 'Contact', 'Contact_2', 'Column H']);
  await expectRows(page, 4);
  await expect(cell(page, 0, 0)).toHaveText('North');

  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByLabel('Sheet')).toHaveValue('Visits');
  await expect(columns(page)).toHaveText(['Visitor', 'Arrived', 'Count', 'Mixed']);
});

test('header row and cell range re-read the sheet, and a header row outside the data says why', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('sales.xlsx')]);
  expect(await columnsOf(page, 'sales.xlsx')).toHaveLength(8);

  const range = page.getByLabel('Cell range');
  await range.fill('a3:c5');
  await range.press('Enter');
  await expect(columns(page)).toHaveText(['Region', 'Order date', 'Amount']);
  await expectRows(page, 2);
  await expect(range).toHaveValue('A3:C5');

  const header = page.getByLabel('Header row', { exact: true });
  await header.fill('0');
  await header.press('Enter');
  await expect(columns(page)).toHaveText(['Column A', 'Column B', 'Column C']);
  await expectRows(page, 3);

  await header.fill('9');
  await header.press('Enter');
  await expect(node(page, 'sales.xlsx')).toHaveAttribute('data-sheet', 'failed');
  await expect(page.getByTestId('excel-panel')).toContainText('Row 9 is outside the data read (A3:C5). Choose a header row from 3 to 5.');
  await expect(page.getByTestId('results-excel')).toContainText('This sheet can’t be read');

  // Not a range: refused in the field, nothing changes.
  await range.fill('A1:B');
  await range.press('Enter');
  await expect(page.getByTestId('excel-panel')).toContainText('Write a range like A1:F200.');
});

test('an old Office file that isn’t a workbook is refused with a plain reason', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [{ name: 'letter.doc', mimeType: 'application/msword', buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) }]);
  await expect(page.getByTestId('canvas-notice')).toContainText('letter.doc is an old Office file that isn’t a workbook, which Puddle doesn’t read.');
});

test('a CSV named .xlsx opens as the CSV it is, and a broken workbook shows why on its node', async ({ page }) => {
  await openApp(page);
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  // The content wins over the name (D24): read as CSV, no sheet to pick.
  await addFiles(page, [{ name: 'table.xlsx', mimeType, buffer: Buffer.from('a,b\n1,2\n') }]);
  await expect(node(page, 'table.xlsx')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'table.xlsx')).toContainText('CSV');
  // A zip that says it is a workbook but holds nothing readable.
  const entry = 'xl/workbook.xml';
  const broken = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, entry.length, 0, 0, 0, ...Buffer.from(entry)]);
  await addFiles(page, [{ name: 'book.xlsx', mimeType, buffer: broken }]);
  await expect(node(page, 'book.xlsx')).toHaveAttribute('data-sheet', 'failed', { timeout: 20_000 });
  await expect(node(page, 'book.xlsx')).toContainText('This spreadsheet can’t be read');
});

/** The sheet the last project saved to IndexedDB reads, once it has been saved. */
const savedSheet = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const id = localStorage.getItem('puddle.lastProject');
        const req = indexedDB.open('puddle');
        req.onsuccess = () => {
          const db = req.result;
          if (!id || !db.objectStoreNames.contains('projects')) return resolve(null);
          const get = db.transaction('projects').objectStore('projects').get(id);
          get.onsuccess = () => resolve((get.result as { sources?: { parseOptions?: { sheet?: string } }[] } | undefined)?.sources?.[0]?.parseOptions?.sheet ?? null);
          get.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      }),
  );

test('a reopened project reads the chosen sheet again once the workbook is chosen again', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('sales.xlsx')]);
  expect(await columnsOf(page, 'sales.xlsx')).toHaveLength(8);
  await page.getByLabel('Sheet').selectOption('Visits');
  await expect(columns(page)).toHaveText(['Visitor', 'Arrived', 'Count', 'Mixed']);
  await expect.poll(() => savedSheet(page)).toBe('Visits');

  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await expect(node(page, 'sales.xlsx')).toHaveAttribute('data-status', 'detached');
  await node(page, 'sales.xlsx').click();
  await expect(page.getByTestId('attachment-banner')).toHaveAttribute('data-state', 'detached');

  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('attachment-banner').getByRole('button', { name: 'Choose file' }).click();
  await (await chooser).setFiles(fixture('sales.xlsx'));
  await expect(node(page, 'sales.xlsx')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(page.getByTestId('attachment-banner')).toHaveCount(0);
  await expect(page.getByLabel('Sheet')).toHaveValue('Visits');
  await expect(columns(page)).toHaveText(['Visitor', 'Arrived', 'Count', 'Mixed']);
  await expectRows(page, 2);
});
