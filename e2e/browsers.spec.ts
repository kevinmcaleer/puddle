import { expect, test } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp, saved, selectNode } from './helpers/app';

// Firefox and Safari can't keep access to files between visits (no showOpenFilePicker). openApp removes the
// picker, so in every browser these tests run as Firefox and Safari always do.

test('without file handles, a reopened project says plainly to choose its files again', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  // Nothing to choose again yet.
  await expect(page.getByTestId('files-not-kept-banner')).toHaveCount(0);
  // Autosave runs a moment after the change; reopen once it has.
  await expect.poll(async () => (await saved(page))?.nodes.length).toBe(1);

  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'detached');
  const banner = page.getByTestId('files-not-kept-banner');
  await expect(banner).toContainText('Files from last time');
  await expect(banner).toContainText('Choose customers.csv again to read it');
  // The one-click reconnect is for browsers that keep handles; it isn't offered here.
  await expect(page.getByTestId('reconnect-banner')).toHaveCount(0);

  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('results-detached').getByRole('button', { name: 'Choose file' }).click();
  await (await chooser).setFiles(fixture('customers.csv'));
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(banner).toHaveCount(0);
  await selectNode(page, 'customers.csv');
  await expectRows(page, 4);
});

test('every file a reopened project needs is chosen in one go, or the note dismissed', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv'), fixture('orders.tsv')]);
  await expect(node(page, 'orders.tsv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect.poll(async () => (await saved(page))?.nodes.length).toBe(2);
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  const banner = page.getByTestId('files-not-kept-banner');
  await expect(banner).toContainText(/Choose (customers\.csv and orders\.tsv|orders\.tsv and customers\.csv) again to read them/);

  // One picker takes both files, in any order, and each goes to the source it belongs to.
  const chooser = page.waitForEvent('filechooser');
  await banner.getByRole('button', { name: 'Choose 2 files' }).click();
  await (await chooser).setFiles([fixture('orders.tsv'), fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'orders.tsv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(banner).toHaveCount(0);

  // Reopened again, the note can be dismissed instead.
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toHaveCount(0);
  await expect(node(page, 'orders.tsv')).toHaveAttribute('data-status', 'detached');
});

// Regression: the preview server left the isolation headers off a 304, so after a reload Safari refused the DuckDB
// worker it had revalidated ("blocked by Cross-Origin-Embedder-Policy") and the engine never started.
test('a revalidated file keeps the cross-origin isolation headers', async ({ page, request }) => {
  await openApp(page);
  const worker = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).find((n) => /duckdb-browser-eh\.worker/.test(n)));
  expect(worker).toBeTruthy();
  const first = await request.get(worker!);
  const etag = first.headers()['etag'];
  expect(etag).toBeTruthy();
  const again = await request.get(worker!, { headers: { 'If-None-Match': etag! } });
  expect(again.status()).toBe(304);
  expect(again.headers()).toMatchObject({ 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' });
});

test('DuckDB that fails to start is started once more', async ({ page }) => {
  // Regression (WebKit): now and then DuckDB's worker failed while starting ("access to a null reference") and the app
  // stayed on "DuckDB didn't start". Here the first DuckDB worker answers every request with that error.
  await page.addInitScript(() => {
    const Real = window.Worker;
    let failed = false;
    window.Worker = class extends Real {
      constructor(url: string | URL, options?: WorkerOptions) {
        const broken = !failed && String(url).includes('duckdb');
        if (broken) failed = true;
        const script = `onmessage = (e) => postMessage({ messageId: 0, requestId: e.data.messageId, type: 'ERROR', data: { name: 'TypeError', message: 'access to a null reference' } });`;
        super(broken ? URL.createObjectURL(new Blob([script], { type: 'text/javascript' })) : url, options);
      }
    };
  });
  const warnings: string[] = [];
  page.on('console', (m) => void (m.type() === 'warning' && warnings.push(m.text())));
  await openApp(page);
  expect(warnings.some((w) => w.startsWith("DuckDB didn't start (instantiate: access to a null reference)"))).toBe(true);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await selectNode(page, 'customers.csv');
  await expectRows(page, 4);
});

test('a query DuckDB stops inside runs once more, and the source still loads', async ({ page }) => {
  // Regression (WebKit): now and then DuckDB stopped inside an ordinary query with a WebAssembly trap ("access to a
  // null reference", "Unreachable code should not be executed"), and the source broke or its rows never showed. Here
  // DuckDB's worker answers the first query reading the new source's columns with that trap.
  await page.addInitScript(() => {
    const Real = window.Worker;
    let trapped = false;
    window.Worker = class extends Real {
      postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
        const m = message as { messageId?: number; type?: string; data?: unknown[] };
        if (!trapped && m?.type === 'START_PENDING_QUERY' && /^DESCRIBE .*read_csv/s.test(String(m.data?.[1]))) {
          trapped = true;
          const data = { messageId: -1, requestId: m.messageId, type: 'ERROR', data: { name: 'RuntimeError', message: "access to a null reference (evaluating 'u(..._)')" } };
          setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data })));
          return;
        }
        super.postMessage(message, transfer as Transferable[]);
      }
    };
  });
  const warnings: string[] = [];
  page.on('console', (m) => void (m.type() === 'warning' && warnings.push(m.text())));
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await selectNode(page, 'customers.csv');
  await expectRows(page, 4);
  expect(warnings.some((w) => w.startsWith('DuckDB stopped inside a query (access to a null reference'))).toBe(true);
});
