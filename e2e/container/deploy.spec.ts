import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addFiles, expectRows, fixture, node, openApp } from '../helpers/app';

const ISOLATION = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' };

test('every response is cross-origin isolated, WASM is typed, hashed files are cached for good', async ({ page, request }) => {
  const index = await request.get('/');
  expect(index.headers()).toMatchObject({ ...ISOLATION, 'content-type': expect.stringMatching(/^text\/html/), 'cache-control': 'no-cache' });
  const html = await index.text();
  expect(html).toContain('rel="manifest"');

  const precache: string[] = await (await request.get('/precache.json')).json();
  const wasm = precache.find((f) => /duckdb-eh-.*\.wasm$/.test(f))!;
  expect(wasm).toBeTruthy();
  const w = await request.head(`/${wasm}`);
  expect(w.headers()).toMatchObject({ ...ISOLATION, 'content-type': 'application/wasm', 'cache-control': 'public, max-age=31536000, immutable' });
  expect((await request.get('/sw.js')).headers()['cache-control']).toBe('no-cache');
  expect((await request.get('/manifest.webmanifest')).headers()['content-type']).toMatch(/^application\/manifest\+json/);
  // Client-side routes fall back to the app.
  expect((await request.get('/projects/anything')).headers()['content-type']).toMatch(/^text\/html/);

  await openApp(page);
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
});

/** Every request the page makes that doesn't go to the app's own origin. */
function offSite(page: Page, base: string) {
  const urls: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).origin !== new URL(base).origin && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) urls.push(r.url());
  });
  return urls;
}

test('JSON and Parquet load and export with no request leaving the site', async ({ page, request, baseURL }) => {
  const manifest = await request.get('/duckdb-extensions/manifest.json');
  // Images built with FETCH_EXTENSIONS=0 (where extensions.duckdb.org can't be reached) have none; CI always does.
  test.skip(!manifest.ok() && !process.env.CI, 'This image was built without the DuckDB extensions.');
  expect(manifest.ok()).toBe(true);
  const away = offSite(page, baseURL!);
  await openApp(page);
  expect(await page.evaluate(() => (globalThis as unknown as { __puddle: { engine: { info: { extensions: string } } } }).__puddle.engine.info.extensions)).toBe(new URL('/duckdb-extensions', baseURL).href);

  await addFiles(page, [fixture('items.json'), fixture('customers.parquet')]);
  await expect(node(page, 'items.json')).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });
  await expect(node(page, 'customers.parquet')).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });
  await node(page, 'items.json').click();
  await expectRows(page, 2);

  // Export the Parquet source as Parquet and JSON, then read each file back in.
  await node(page, 'customers.parquet').click();
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await node(page, 'Output 1').click();
  for (const [format, label, ext] of [['parquet', 'Export Parquet', 'parquet'], ['json', 'Export JSON', 'json'], ['ndjson', 'Export NDJSON', 'ndjson']] as const) {
    await page.getByLabel('Format').selectOption(format);
    const download = page.waitForEvent('download');
    await page.locator('.ui-resultsbar').getByRole('button', { name: label }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`Output 1.${ext}`);
    const path = await file.path();
    await addFiles(page, [{ name: `back.${ext}`, mimeType: 'application/octet-stream', buffer: readFileSync(path) }]);
    await expect(node(page, `back.${ext}`)).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });
    await node(page, `back.${ext}`).click();
    await expectRows(page, 4);
    await node(page, 'Output 1').click();
  }
  expect(away).toEqual([]);
});

test('after the first visit the app loads and runs a flow offline', async ({ page, context }) => {
  await openApp(page);
  // Wait for the service worker to finish precaching (it activates once everything is cached).
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) throw new Error('No active service worker.');
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, 'customers.csv').click();
  await expectRows(page, 4);
});
