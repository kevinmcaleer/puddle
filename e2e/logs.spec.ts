import { expect, test } from '@playwright/test';
import { addFiles, columnsOf, expectRows, fixture, node, openApp } from './helpers/app';

test('an access log opens as columns, the Lines picker switches to a custom pattern, and lines that don’t fit are counted', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('logs/access.log')]);
  await expect(node(page, 'access.log')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'access.log')).toContainText('Source · Log');
  expect(await columnsOf(page, 'access.log')).toEqual(['host', 'ident', 'user', 'time', 'method', 'path', 'protocol', 'status', 'bytes', 'referrer', 'agent']);
  await expectRows(page, 4);
  await expect(page.getByLabel('Lines')).toHaveValue('combined');
  await expect(page.getByTestId('rewrite-size')).toHaveText('4 rows, 11 columns; 1 line didn’t fit and was left out');

  await page.getByLabel('Lines').selectOption('custom');
  await page.getByLabel('Pattern').fill('^(?<host>\\S+) .*" (?<status>\\d{3}) ');
  await expect(page.getByTestId('rewrite-size')).toHaveText('4 rows, 2 columns; 1 line didn’t fit and was left out');
  expect(await columnsOf(page, 'access.log')).toEqual(['host', 'status']);
});
