import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { startFileServer, type FileServer } from '../../tests/helpers/fileServer';
import { expectRows, fixture, node, openApp } from '../helpers/app';

// URL sources against the container: JSON and Parquet need the self-hosted extensions, which only the image has.
let server: FileServer;

test.beforeAll(async () => {
  server = await startFileServer({ cors: true, ranges: true });
  server.files.set('/items.json', { body: readFileSync(fixture('items.json')), type: 'application/json' });
  server.files.set('/customers.parquet', { body: readFileSync(fixture('customers.parquet')), type: 'application/vnd.apache.parquet' });
});
test.afterAll(() => server.close());

test('the container’s headers let the page fetch user-entered addresses', async ({ request }) => {
  const csp = (await request.get('/')).headers()['content-security-policy'] ?? '';
  // No policy at all, or one that doesn't limit where the page may connect.
  expect(csp).not.toMatch(/connect-src|default-src/);
});

test('JSON and Parquet load from a web address; Parquet is read by range requests', async ({ page, request }) => {
  const manifest = await request.get('/duckdb-extensions/manifest.json');
  test.skip(!manifest.ok() && !process.env.CI, 'This image was built without the DuckDB extensions.');
  await openApp(page);
  for (const path of ['/items.json', '/customers.parquet']) {
    await page.getByRole('button', { name: 'Add source' }).first().click();
    await page.getByRole('menuitem', { name: /From URL/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Add source from a web address' });
    await dialog.getByLabel('Address').fill(server.url(path));
    await dialog.getByRole('button', { name: 'Add source' }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(node(page, 'items.json')).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });
  await expect(node(page, 'customers.parquet')).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });
  await node(page, 'items.json').click();
  await expectRows(page, 2);
  await node(page, 'customers.parquet').click();
  await expectRows(page, 4);
  await expect(page.getByTestId('url-fetched')).toContainText('read in parts as needed');
  const parquet = server.requests.filter((r) => r.path === '/customers.parquet');
  expect(parquet.some((r) => r.method === 'HEAD')).toBe(true);
  expect(parquet.every((r) => r.method !== 'GET' || r.range)).toBe(true);
});
