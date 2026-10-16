import { expect, test, type Page } from '@playwright/test';
import { addFiles, fixture, node, openApp, pasteText } from './helpers/app';
import { mockGistApi, TOKEN } from './helpers/gist';

const projectMenu = async (page: Page, item: string) => {
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: item }).click();
};

const syncState = (page: Page) => page.getByTestId('sync-state');

async function rename(page: Page, name: string) {
  await projectMenu(page, 'Rename');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByTestId('project-menu')).toContainText(name);
}

/** Connect with the token and start syncing the open project. */
async function startSyncing(page: Page) {
  await projectMenu(page, 'Sync to GitHub Gist');
  const dialog = page.getByRole('dialog', { name: 'Sync to GitHub Gist' });
  await dialog.getByLabel('Personal access token').fill(TOKEN);
  await dialog.getByRole('button', { name: 'Connect and sync' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(syncState(page)).toHaveAttribute('data-state', 'synced');
}

/** What this browser keeps in an IndexedDB store, as JSON. */
const store = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      new Promise<string>((resolve, reject) => {
        const req = indexedDB.open('puddle');
        req.onsuccess = () => {
          const all = req.result.transaction(n).objectStore(n).getAll();
          all.onsuccess = () => resolve(JSON.stringify(all.result));
          all.onerror = () => reject(all.error);
        };
        req.onerror = () => reject(req.error);
      }),
    name,
  );

test('a project synced in one browser opens from the Gist in another, without its data', async ({ page, browser }) => {
  const api = mockGistApi();
  await api.route(page.context());
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await pasteText(page, 'sku\tqty\nPASTED-ROW-7\t3\n');
  await expect(node(page, 'Pasted data')).toHaveAttribute('data-status', 'ok');
  // A URL source with a saved request header, as an older or imported project may carry.
  await page.evaluate(() => {
    const store = (globalThis.__puddle as unknown as { store: { getState(): { apply(edit: (p: { sources: unknown[] }) => unknown): void } } }).store;
    store.getState().apply((p) => ({
      ...p,
      sources: [...p.sources, { id: 's_api', name: 'api.csv', kind: 'url', url: { href: 'https://example.com/api.csv', headers: { Authorization: 'Bearer HEADER-SECRET-9' } }, format: 'csv', parseOptions: {}, detectedSchema: [] }],
    }));
  });
  await rename(page, 'Orders sync');
  await startSyncing(page);

  // One secret Gist with the project file: the steps, never the rows, and never the token.
  expect(api.gists.size).toBe(1);
  const gist = api.gists.get('gist1')!;
  expect(gist.public).toBe(false);
  expect(gist.description).toBe('Puddle project: Orders sync');
  const file = api.file();
  expect(file.filename).toBe('orders-sync.puddle.json');
  expect(file.content).toContain('"customers.csv"');
  expect(file.content).not.toContain('PASTED-ROW-7');
  expect(file.content).not.toContain('Ada');
  expect(file.content).not.toContain(TOKEN);
  // Request headers sync by name only; the value stays in this browser.
  expect(file.content).not.toContain('HEADER-SECRET-9');
  expect(file.content).toContain('"Authorization": ""');
  expect(await store(page, 'projects')).toContain('HEADER-SECRET-9');
  // The token is kept in this browser, apart from the project.
  expect(await store(page, 'credentials')).toContain(TOKEN);
  expect(await store(page, 'projects')).not.toContain(TOKEN);

  // A later change pushes once autosave settles, renaming the file with the project.
  await rename(page, 'Orders synced');
  await expect.poll(() => api.file().filename).toBe('orders-synced.puddle.json');
  await expect(syncState(page)).toHaveAttribute('data-state', 'synced');
  expect(api.gists.size).toBe(1);

  // Another browser on the same GitHub account.
  const other = await browser.newContext();
  await api.route(other);
  const laptop = await other.newPage();
  await openApp(laptop);
  await projectMenu(laptop, 'All projects');
  await laptop.getByRole('button', { name: 'Open from GitHub Gist' }).click();
  const dialog = laptop.getByRole('dialog', { name: 'Open from GitHub Gist' });
  await dialog.getByLabel('Personal access token').fill(TOKEN);
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await dialog.getByTestId('remote-Orders synced').getByRole('button', { name: 'Open' }).click();
  await expect(laptop.getByTestId('project-menu')).toContainText('Orders synced');
  await expect(node(laptop, 'customers.csv')).toBeVisible();
  await expect(node(laptop, 'Pasted data')).toBeVisible();
  await expect(syncState(laptop)).toHaveAttribute('data-state', 'synced');
  await other.close();
});

test('a conflicting edit waits for a choice: take remote, then keep mine, then save a copy', async ({ page }) => {
  const api = mockGistApi();
  await api.route(page.context());
  await openApp(page);
  await rename(page, 'Shared');
  await startSyncing(page);

  // Another browser changes the Gist while this one changes the project too.
  api.editElsewhere((p) => ({ ...p, notes: 'Written on the laptop', updatedAt: '2026-10-16T08:30:00.000Z' }));
  await rename(page, 'Shared here');
  const banner = page.getByTestId('sync-conflict');
  await expect(banner).toContainText('This project changed in another browser too');
  await expect(syncState(page)).toHaveAttribute('data-state', 'conflict');
  await expect(banner.getByTestId('sync-local-time')).not.toBeEmpty();
  await expect(banner.getByTestId('sync-remote-time')).toContainText('16 Oct 2026');
  // Nothing was written over the laptop's change.
  expect(api.file().content).toContain('Written on the laptop');
  expect(api.file().content).not.toContain('Shared here');

  await banner.getByRole('button', { name: 'Take remote' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId('project-menu')).toContainText('Shared');
  await expect(page.getByTestId('project-menu')).not.toContainText('Shared here');
  await expect(syncState(page)).toHaveAttribute('data-state', 'synced');

  // Again, and this time keep this browser's version.
  api.editElsewhere((p) => ({ ...p, notes: 'Second laptop edit' }));
  await rename(page, 'Mine wins');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Keep mine' }).click();
  await expect(syncState(page)).toHaveAttribute('data-state', 'synced');
  expect(api.file().content).toContain('"name": "Mine wins"');
  expect(api.file().content).not.toContain('Second laptop edit');

  // And once more, keeping both.
  api.editElsewhere((p) => ({ ...p, name: 'Laptop name' }));
  await rename(page, 'Desk name');
  await banner.getByRole('button', { name: 'Save mine as a copy' }).click();
  await expect(page.getByTestId('project-menu')).toContainText('Laptop name');
  await expect(syncState(page)).toHaveAttribute('data-state', 'synced');
  await projectMenu(page, 'All projects');
  await expect(page.getByTestId('project-Desk name (this browser)')).toBeVisible();
  await expect(page.getByTestId('project-Laptop name')).toBeVisible();
});

test('offline changes queue and push when the browser is back online', async ({ page, context }) => {
  const api = mockGistApi();
  await api.route(context);
  await openApp(page);
  await rename(page, 'Travelling');
  await startSyncing(page);

  await context.setOffline(true);
  await expect(syncState(page)).toHaveAttribute('data-state', 'offline');
  await rename(page, 'Written offline');
  await expect(syncState(page)).toHaveAttribute('data-state', 'offline');
  // Give autosave and the sync delay time to have pushed, had they been going to.
  await page.waitForTimeout(2500);
  expect(api.file().content).not.toContain('Written offline');

  await context.setOffline(false);
  await expect.poll(() => api.file().content).toContain('Written offline');
  await expect(syncState(page)).toHaveAttribute('data-state', 'synced');
});

test('disconnecting removes the token and stops syncing', async ({ page }) => {
  const api = mockGistApi();
  await api.route(page.context());
  await openApp(page);
  await rename(page, 'Short lived');
  await startSyncing(page);

  await projectMenu(page, 'Sync to GitHub Gist');
  const dialog = page.getByRole('dialog', { name: 'Sync to GitHub Gist' });
  await dialog.getByRole('button', { name: 'Disconnect GitHub' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(syncState(page)).toHaveCount(0);
  await expect.poll(() => store(page, 'credentials')).toBe('[]');
  expect(await store(page, 'syncLinks')).toBe('[]');

  // Changes now stay in this browser, and the Gist stays on GitHub.
  const before = api.requests.length;
  await rename(page, 'Local again');
  await page.waitForTimeout(2500);
  expect(api.requests.length).toBe(before);
  expect(api.gists.size).toBe(1);
});
