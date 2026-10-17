import { expect, test } from '@playwright/test';
import { node, openApp } from '../helpers/app';

// The user guide and the taxi tutorial's files, as the image serves them. The tutorial's files come from the TLC's
// own site, through nginx, so these tests need the container to reach the internet (CI's does).
const TRIPS = '/tutorial-data/trip-data/yellow_tripdata_2024-01.parquet';
const ZONES = '/tutorial-data/misc/taxi_zone_lookup.csv';

test('the image serves the user guide at /docs/', async ({ request }) => {
  const index = await request.get('/docs/');
  expect(index.status()).toBe(200);
  expect(index.headers()).toMatchObject({ 'content-type': expect.stringMatching(/^text\/html/), 'cross-origin-embedder-policy': 'require-corp' });
  expect(await index.text()).toContain('Puddle');
  expect(await (await request.get('/docs/tutorial-taxi.html')).text()).toContain('three million taxi trips');
  // Without the slash, a redirect that keeps whatever address the browser used.
  const bare = await request.get('/docs', { maxRedirects: 0 });
  expect(bare.status()).toBe(301);
  expect(bare.headers().location).toBe('/docs/');
  expect((await request.get('/docs/no-such-page.html')).status()).toBe(404);
});

test('the image passes the taxi tutorial’s two files through from the TLC, in parts, and nothing else', async ({ request }) => {
  const part = await request.get(ZONES, { headers: { Range: 'bytes=0-99' } });
  expect(part.status()).toBe(206);
  expect(part.headers()['content-range']).toMatch(/^bytes 0-99\/\d+$/);
  expect(part.headers()).toMatchObject({ 'cross-origin-resource-policy': 'same-origin', 'cache-control': 'no-store' });
  expect(await part.text()).toMatch(/^"LocationID","Borough","Zone"/);
  expect((await request.head(TRIPS)).headers()['content-length']).toMatch(/^\d{7,}$/);
  expect((await request.get('/tutorial-data/misc/other.csv')).status()).toBe(404);
  expect((await request.get('/tutorial-data/trip-data/yellow_tripdata_2024-02.parquet')).status()).toBe(404);
  expect((await request.post(ZONES)).status()).toBe(403);
});

test('Help starts the taxi tutorial on the real files, and opens the guide', async ({ page, context }) => {
  await openApp(page);
  await page.getByTestId('help-menu').click();
  await page.getByRole('menuitem', { name: 'Start the taxi tutorial' }).click();
  await expect(page.getByTestId('project-name')).toHaveText('Tutorial: three million taxi trips');
  await expect(node(page, 'yellow_tripdata_2024-01.parquet')).toHaveAttribute('data-status', 'ok', { timeout: 90_000 });
  await expect(node(page, 'taxi_zone_lookup.csv')).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-rows', '2964624', { timeout: 90_000 });

  const guide = context.waitForEvent('page');
  await page.getByTestId('notes-preview').getByRole('link', { name: 'the taxi tutorial in the user guide' }).click();
  const tutorial = await guide;
  await expect(tutorial.getByRole('heading', { level: 1 })).toContainText('three million taxi trips');
});
