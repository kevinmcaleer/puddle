import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { startFileServer, type FileServer } from '../tests/helpers/fileServer';
import { expectRows, fixture, node, openApp, selectNode } from './helpers/app';

// Fixtures come from local servers started here: one sends CORS headers and supports range requests, the other
// sends neither, the way many servers on the web behave.
let open: FileServer;
let closed: FileServer;

test.beforeAll(async () => {
  open = await startFileServer({ cors: true, ranges: true });
  closed = await startFileServer({ cors: false });
  for (const s of [open, closed]) {
    s.files.set('/customers.csv', { body: readFileSync(fixture('customers.csv')), type: 'text/csv' });
    s.files.set('/download', { body: readFileSync(fixture('orders.tsv')), type: 'text/plain' });
  }
});
test.afterAll(async () => {
  await Promise.all([open.close(), closed.close()]);
});

async function addFromUrl(page: Page, address: string, format?: string) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /From URL/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Add source from a web address' });
  await dialog.getByLabel('Address').fill(address);
  if (format) await dialog.getByLabel('Format').selectOption(format);
  await dialog.getByRole('button', { name: 'Add source' }).click();
  return dialog;
}

test('a CSV added from a web address loads, shows its host, and re-fetches on reopening with no file to choose', async ({ page }) => {
  await openApp(page);
  const dialog = await addFromUrl(page, open.url('/customers.csv'));
  await expect(dialog).toHaveCount(0);
  const source = node(page, 'customers.csv');
  await expect(source).toHaveAttribute('data-status', 'ok');
  await expect(source).toContainText(`${new URL(open.url('/')).host} · CSV`);
  await expectRows(page, 4);
  await expect(page.getByTestId('url-address')).toHaveText(open.url('/customers.csv'));
  await expect(page.getByTestId('url-fetched')).toContainText('Fetched at');

  // Wait for autosave, then reopen the tab: the source is fetched again by itself.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('puddle.lastProject'))).not.toBeNull();
  await page.waitForTimeout(800);
  const before = open.requests.filter((r) => r.path === '/customers.csv').length;
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  expect(open.requests.filter((r) => r.path === '/customers.csv').length).toBeGreaterThan(before);
  await expect(page.getByTestId('results-detached')).toHaveCount(0);
  await expectRows(page, 4);
  await selectNode(page, 'customers.csv');
  await expect(page.getByTestId('url-panel')).toHaveAttribute('data-attachment', 'attached');
  await expect(page.getByTestId('attachment-banner')).toHaveCount(0);
});

test('Refresh fetches the file again and says when it has changed', async ({ page }) => {
  open.files.set('/changing.csv', { body: readFileSync(fixture('customers.csv')), type: 'text/csv' });
  await openApp(page);
  await addFromUrl(page, open.url('/changing.csv'));
  await expectRows(page, 4);
  open.files.set('/changing.csv', { body: readFileSync(fixture('customers.csv'), 'utf8') + '5,Grace Hopper,grace@example.org,2026-02-01\n', type: 'text/csv' });
  const panel = page.getByTestId('url-panel');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(panel).toHaveAttribute('data-attachment', 'mismatch');
  await expect(panel).toContainText('This file has changed');
  await expectRows(page, 5);
  // Nothing changed since: the warning goes.
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(panel).toHaveAttribute('data-attachment', 'attached');
  await expect(panel).not.toContainText('This file has changed');
});

test('a server without CORS headers gives the explained error, with a way to download the file instead', async ({ page }) => {
  await openApp(page);
  const dialog = await addFromUrl(page, closed.url('/customers.csv'));
  const error = dialog.getByTestId('url-error');
  await expect(error).toHaveAttribute('data-kind', 'cors');
  await expect(error).toContainText('This server doesn’t allow other sites to read the file. Download it and drop it here instead.');
  await expect(error).toContainText('never sends data through a server of its own');
  await expect(error.getByRole('button', { name: 'Download' })).toBeVisible();

  // "Choose file" closes the dialog and opens the file chooser.
  const chooser = page.waitForEvent('filechooser');
  await error.getByRole('button', { name: 'Choose file' }).click();
  await (await chooser).setFiles(fixture('customers.csv'));
  await expect(dialog).toHaveCount(0);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
});

test('a source whose server stops allowing CORS says why on the canvas and in the results', async ({ page }) => {
  await openApp(page);
  await addFromUrl(page, open.url('/customers.csv'));
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  // Point the saved source at the server without CORS, as if it had changed, and reopen.
  await page.evaluate((href) => {
    const store = (globalThis as unknown as { __puddle: { store: { getState(): { amend(f: (p: { sources: { url?: { href: string } }[] }) => unknown): void } } } }).__puddle.store;
    store.getState().amend((p) => ({ ...p, sources: p.sources.map((s) => ({ ...s, url: { href } })) }));
  }, closed.url('/customers.csv'));
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  const source = node(page, 'customers.csv');
  await expect(source).toHaveAttribute('data-fetch', 'failed');
  await expect(source).toContainText('This server doesn’t allow other sites to read the file');
  await expect(page.getByTestId('results-url')).toContainText('The server blocked this');
  await expect(page.getByTestId('results-url').getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('plain http addresses are refused with the reason', async ({ page }) => {
  await openApp(page);
  const dialog = await addFromUrl(page, 'http://data.example.org/orders.csv');
  await expect(dialog.getByTestId('url-error')).toHaveAttribute('data-kind', 'address');
  await expect(dialog.getByTestId('url-error')).toContainText('mixed content');
  await expect(dialog.getByLabel('Address')).toHaveClass(/is-error/);
});

test('when neither the address nor the server says the format, choosing one reads the file', async ({ page }) => {
  await openApp(page);
  const dialog = await addFromUrl(page, open.url('/download'));
  await expect(dialog.getByTestId('url-error')).toContainText('Choose the format');
  await dialog.getByLabel('Format').selectOption('tsv');
  await dialog.getByRole('button', { name: 'Add source' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(node(page, 'download')).toHaveAttribute('data-status', 'ok');
  await expect(node(page, 'download')).toContainText('TSV');
  await expectRows(page, 3);
});

test('DuckDB reads a registered address by HTTP range requests in the browser', async ({ page }) => {
  await openApp(page);
  const href = open.url('/customers.csv');
  const n = await page.evaluate(async (url) => {
    const engine = (globalThis as unknown as { __puddle: { engine: { registerUrl(n: string, u: string): Promise<void>; query(sql: string): Promise<{ table: { get(i: number): { toJSON(): { n: bigint } } } }> } } }).__puddle.engine;
    await engine.registerUrl('ranged.csv', url);
    const r = await engine.query(`SELECT count(*)::INTEGER AS n FROM read_csv('ranged.csv')`);
    return Number(r.table.get(0).toJSON().n);
  }, href);
  expect(n).toBe(4);
  expect(open.requests.some((r) => r.path === '/customers.csv' && r.method === 'HEAD' && r.range === 'bytes=0-')).toBe(true);
  expect(open.requests.some((r) => r.path === '/customers.csv' && r.method === 'GET' && /^bytes=\d+-\d+$/.test(r.range ?? ''))).toBe(true);
});
