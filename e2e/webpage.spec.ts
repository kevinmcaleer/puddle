import { expect, test, type Page } from '@playwright/test';
import { columnsOf, expectRows, fixtureText, node, openApp } from './helpers/app';

// Tables on a web page. Wikipedia is answered here, the way its API answers (with CORS); the blocked site refuses
// the way a site without CORS does.
const BOND = fixtureText('bond-films.html');
const ARTICLE = 'https://en.wikipedia.org/wiki/List_of_James_Bond_films';

async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /From web page/ }).click();
  return page.getByRole('dialog', { name: 'Add source from a web page' });
}

test('the James Bond films come in from Wikipedia: find the tables, pick one, add it', async ({ page }) => {
  await page.route(/^https:\/\/en\.wikipedia\.org\/w\/api\.php\?/,(route) =>
    route.fulfill({ json: { parse: { title: 'List of James Bond films', text: BOND } }, headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  await openApp(page);
  const dialog = await openDialog(page);
  await dialog.getByLabel('Address').fill(ARTICLE);
  await dialog.getByRole('button', { name: 'Find tables' }).click();

  // The biggest table is offered first, with a preview.
  const table = dialog.getByLabel(/^Table/);
  await expect(table).toHaveValue('1');
  await expect(dialog.getByTestId('web-tables')).toContainText('25 rows, 5 columns. Read through Wikipedia’s own API.');
  await expect(dialog.getByTestId('web-table-preview')).toContainText('Dr. No');
  await table.selectOption({ label: 'Non-Eon films (2 rows, 4 columns)' });
  await expect(dialog.getByTestId('web-table-preview')).toContainText('Never Say Never Again');
  await table.selectOption('1');
  await dialog.getByRole('button', { name: 'Add source' }).click();
  await expect(dialog).toHaveCount(0);

  const source = node(page, 'Eon Productions films');
  await expect(source).toHaveAttribute('data-status', 'ok');
  await expect(source).toContainText('en.wikipedia.org · Web table');
  await expectRows(page, 25);
  expect(await columnsOf(page, 'Eon Productions films')).toEqual(['Title', 'Year', 'Bond actor', 'Director', 'Box office (US$ millions) Actual']);
  await expect(page.getByTestId('url-table')).toHaveText('Table: Eon Productions films');
});

test('a site that blocks other sites: Puddle says so, and takes the table copied and pasted instead', async ({ page }) => {
  await page.route('https://closed.example/**', (route) => route.abort());
  await openApp(page);
  const dialog = await openDialog(page);
  await dialog.getByLabel('Address').fill('https://closed.example/prices');
  await dialog.getByRole('button', { name: 'Find tables' }).click();
  const error = dialog.getByTestId('web-error');
  await expect(error).toHaveAttribute('data-kind', 'cors');
  await expect(error).toContainText('can’t fetch it from your browser');

  await error.getByRole('button', { name: 'Paste instead' }).click();
  const box = dialog.getByLabel('Pasted table');
  // What the clipboard holds after copying a table on a page: its HTML.
  await box.evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/html', '<meta charset="utf-8"><h2>Prices</h2><table><tr><th>Item</th><th>Price</th></tr><tr><td>Tea</td><td>2.50</td></tr><tr><td>Cake</td><td>3.10</td></tr></table>');
    data.setData('text/plain', 'Item\tPrice\nTea\t2.50\nCake\t3.10');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(dialog.getByTestId('web-table-preview')).toContainText('Cake');
  await dialog.getByRole('button', { name: 'Add source' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(node(page, 'Prices')).toHaveAttribute('data-status', 'ok');
  await expectRows(page, 2);
  expect(await columnsOf(page, 'Prices')).toEqual(['Item', 'Price']);
});
