import { expect, test, type Page } from '@playwright/test';
import { addFiles, cell, columnsOf, expectRows, fixture, node, openApp } from './helpers/app';

const columns = (page: Page) => page.getByTestId('inspector-columns').locator('.ui-col');

test('an XML file reads its repeating records into columns, and repeats inside a record can each get a row', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('books.xml')]);
  await expect(node(page, 'books.xml')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(page.getByTestId('inspector-source')).toContainText('Source · XML');
  expect(await columnsOf(page, 'books.xml')).toEqual(['id', 'format', 'title', 'published', 'price', 'price.currency', 'author', 'stock']);
  await expectRows(page, 3);
  await expect(cell(page, 0, 0)).toHaveText('bk101');
  await expect(page.getByLabel('Record element').locator('option')).toHaveText(['catalog › book (3)', 'catalog › book › author (4)']);

  await expect(page.getByLabel('A row for each').locator('option')).toHaveText(['book', 'author in each book']);
  await page.getByLabel('A row for each').selectOption('author');
  await expectRows(page, 4);
  await expect(cell(page, 6, 2)).toHaveText('Neil Gaiman');

  await page.getByLabel('Record element').selectOption('catalog/book/author');
  await expect(columns(page)).toHaveText(['author']);
  await expectRows(page, 4);
  await expect(page.getByLabel('A row for each')).toHaveValue('');
});
