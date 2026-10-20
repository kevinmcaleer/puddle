import { expect, test } from '@playwright/test';
import { addFiles, columnsOf, expectRows, fixture, node, openApp } from './helpers/app';

test('a file is read by what is in it: a semicolon CSV named .txt and tabs named .csv open right, and plain text asks', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('sniff/orders.txt'), fixture('sniff/pairs.csv')]);
  // Both opened with no question: the right columns, from the content, with the delimiter it found. (JSON named
  // .csv is the engine test's case: the browser here may not reach DuckDB's JSON extension.)
  expect(await columnsOf(page, 'orders.txt')).toEqual(['id', 'customer', 'total']);
  await expect(page.getByLabel('Delimiter')).toHaveValue(';');
  await expect(page.getByLabel('Format')).toHaveValue('csv');
  expect(await columnsOf(page, 'pairs.csv')).toEqual(['code', 'city']);
  await expect(page.getByLabel('Format')).toHaveValue('tsv');
  await expect(page.getByTestId('format-dialog')).toHaveCount(0);

  // Plain text could be anything: the Format picker asks, and the choice is kept on the source.
  await addFiles(page, [fixture('sniff/notes.txt')]);
  const dialog = page.getByTestId('format-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Plain lines');
  await page.getByLabel('Format').last().selectOption('csv');
  await page.getByLabel('First row is the header').last().click();
  await page.getByRole('button', { name: 'Read it this way' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(node(page, 'notes.txt')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, 'notes.txt').click();
  // Four lines, the blank one included, each a row now the first isn't a header.
  await expectRows(page, 4);
  await expect(page.getByTestId('inspector-source').getByLabel('First row is the header')).toHaveAttribute('aria-checked', 'false');
});
