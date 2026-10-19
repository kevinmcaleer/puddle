import { expect, test } from '@playwright/test';
import { fixtureText, openApp } from './helpers/app';

const read = async (download: import('@playwright/test').Download) => Buffer.concat(await (await download.createReadStream()).toArray()).toString('utf8');

test('a share link opens the schema read-only in a fresh browser, as an embed, and keeps it in a new project', async ({ page, browser }) => {
  await openApp(page);
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
  await page.getByRole('combobox', { name: 'DBML' }).fill(fixtureText('dbml/shop.dbml'));
  await expect(page.getByTestId('schema-table-orders')).toBeVisible();

  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share the schema' });
  await expect(dialog.getByTestId('share-notice')).toContainText('It carries the schema itself');
  const link = await dialog.getByLabel('Link').inputValue();
  expect(link).toContain('#schema=1');
  await dialog.getByRole('switch', { name: 'Embed the diagram in another page' }).click();
  await expect(dialog.getByTestId('share-embed')).toContainText(`<iframe src="${link.replace(/&/g, '&amp;')}&amp;embed=1"`);

  // A fresh browser, with none of this one's projects.
  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await other.goto(link);
  const shared = other.getByTestId('shared-schema');
  await expect(shared.getByTestId('schema-table-orders')).toBeVisible({ timeout: 20_000 });
  await expect(shared).toContainText('Read-only');

  const embed = await fresh.newPage();
  await embed.goto(`${link}&embed=1`);
  await expect(embed.getByTestId('schema-table-customers')).toBeVisible({ timeout: 20_000 });
  await expect(embed.getByRole('button', { name: 'Open in a new project' })).toHaveCount(0);

  await shared.getByRole('button', { name: 'Open in a new project' }).click();
  await expect(other.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  expect(new URL(other.url()).hash).toBe('');
  await other.getByTestId('project-menu').click();
  await other.getByRole('menuitem', { name: 'Schema' }).click();
  await expect(other.getByRole('combobox', { name: 'DBML' })).toContainText('Table orders');
  await fresh.close();
});

test('the docs export is one page with the diagram, every table and a search box', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
  await page.getByRole('combobox', { name: 'DBML' }).fill(fixtureText('dbml/shop.dbml'));
  await expect(page.getByTestId('schema-table-orders')).toBeVisible();
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /^Docs/ }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Export docs' }).getByRole('button', { name: /^Download .*\.html$/ }).click();
  const html = await read(await download);
  expect(html).toContain('<svg');
  for (const t of ['customers', 'orders', 'products', 'order_items']) expect(html).toContain(`id="table-${t}"`);
  expect(html).toContain('type="search"');
  expect(html).not.toMatch(/(src|href)="https?:/);
});
