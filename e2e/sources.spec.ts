import { expect, test } from '@playwright/test';
import { addFiles, cell, columnsOf, expectRows, fixture, fixtureText, node, openApp, pasteText } from './helpers/app';

test('a CSV added from the file chooser becomes a source node and fills the results table', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  const source = node(page, 'customers.csv');
  await expect(source).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('results-title')).toHaveText('customers.csv');
  await expectRows(page, 4);
  await expect(page.getByRole('status').filter({ hasText: 'rows' })).toContainText('4 rows');
  await expect(page.getByRole('status').filter({ hasText: 'rows' })).toContainText('4 cols');
  expect(await columnsOf(page, 'customers.csv')).toEqual(['id', 'name', 'email', 'joined']);
});

test('TSV files are read with a tab delimiter', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('orders.tsv')]);
  await expect(node(page, 'orders.tsv')).toHaveAttribute('data-status', 'ok');
  expect((await columnsOf(page, 'orders.tsv')).length).toBeGreaterThan(1);
});

test('a file dropped on the canvas is added where it lands', async ({ page }) => {
  await openApp(page);
  const text = fixtureText('customers.csv');
  const drop = await page.evaluateHandle((t) => {
    const dt = new DataTransfer();
    dt.items.add(new File([t], 'dropped.csv', { type: 'text/csv' }));
    return dt;
  }, text);
  const canvas = page.getByTestId('canvas');
  await canvas.dispatchEvent('dragover', { dataTransfer: drop });
  await canvas.dispatchEvent('drop', { dataTransfer: drop, clientX: 400, clientY: 300 });
  await expect(node(page, 'dropped.csv')).toHaveAttribute('data-status', 'ok');
});

test('pasting rows onto the canvas adds a clipboard source', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('canvas').click();
  await pasteText(page, 'sku\tqty\nA1\t3\nB2\t5\n');
  await expect(node(page, 'Pasted data')).toHaveAttribute('data-status', 'ok');
  await expectRows(page, 2);
  expect(await columnsOf(page, 'Pasted data')).toEqual(['sku', 'qty']);
});

test('changing the delimiter in the inspector re-reads the file', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('semicolon.csv')]);
  expect(await columnsOf(page, 'semicolon.csv')).toEqual(['id', 'city']);

  await page.getByLabel('Delimiter').selectOption({ label: 'Comma' });
  await expect(page.getByTestId('inspector-columns').locator('.ui-col')).toHaveText(['id;city']);

  await page.getByLabel('Delimiter').selectOption({ label: 'Semicolon' });
  await expect(page.getByTestId('inspector-columns').locator('.ui-col')).toHaveText(['id', 'city']);

  // The option change is one undo step.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Delimiter')).toHaveValue(',');
  await expect(page.getByTestId('inspector-columns').locator('.ui-col')).toHaveText(['id;city']);
});

test('treat-as-empty values come through as nulls', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('semicolon.csv')]);
  await expectRows(page, 3);
  await expect(cell(page, 1, 1)).toHaveText('N/A');
  const input = page.getByLabel('Treat as empty');
  await input.fill('N/A');
  await input.press('Enter');
  await expect(cell(page, 1, 1)).toHaveText('null');
  await expect(cell(page, 1, 0)).toHaveText('Leeds');
});

test('a file in a format Puddle doesn’t read is refused with a reason', async ({ page }) => {
  // Excel workbooks used to be refused here; they are read now, and their flows are covered in excel.spec.ts.
  await openApp(page);
  await addFiles(page, [{ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }]);
  await expect(page.getByTestId('canvas-notice')).toContainText('photo.png isn\'t a format Puddle reads. Add a CSV, TSV, JSON, NDJSON, Parquet or Excel (.xlsx) file.');
});
