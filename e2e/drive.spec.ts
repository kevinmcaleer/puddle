import { expect, test, type Page } from '@playwright/test';
import { addFiles, fixture, node, openApp, pasteText } from './helpers/app';
import { E2E_GOOGLE_CLIENT_ID, mockGoogleDrive } from './helpers/drive';

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

/** Everything this browser keeps for the page: IndexedDB's stores, local and session storage, as one string. */
const kept = (page: Page) =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('puddle');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const stores = await Promise.all(
      Array.from(db.objectStoreNames).map(
        (n) =>
          new Promise<unknown>((resolve, reject) => {
            const all = db.transaction(n).objectStore(n).getAll();
            all.onsuccess = () => resolve(all.result);
            all.onerror = () => reject(all.error);
          }),
      ),
    );
    db.close();
    return { idb: JSON.stringify(stores), local: JSON.stringify({ ...localStorage }), session: JSON.stringify({ ...sessionStorage }) };
  });

/** Sign in with Google from the open project's menu and start syncing it: off to Google and back. */
async function startSyncing(page: Page) {
  await projectMenu(page, 'Sync to Google Drive');
  const dialog = page.getByRole('dialog', { name: 'Sync to Google Drive' });
  await dialog.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await expect(syncState(page)).toHaveAttribute('data-state', 'synced');
}

test('a project synced to Google Drive opens in another browser, without its data or the token', async ({ page, browser }) => {
  const google = mockGoogleDrive();
  await google.route(page.context());
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await pasteText(page, 'sku\tqty\nPASTED-ROW-7\t3\n');
  await expect(node(page, 'Pasted data')).toHaveAttribute('data-status', 'ok');
  await page.evaluate(() => {
    const store = (globalThis.__puddle as unknown as { store: { getState(): { apply(edit: (p: { sources: unknown[] }) => unknown): void } } }).store;
    store.getState().apply((p) => ({
      ...p,
      sources: [...p.sources, { id: 's_api', name: 'api.csv', kind: 'url', url: { href: 'https://example.com/api.csv', headers: { Authorization: 'Bearer HEADER-SECRET-9' } }, format: 'csv', parseOptions: {}, detectedSchema: [] }],
    }));
  });
  await rename(page, 'Orders drive');
  await startSyncing(page);

  // Google was asked for an access token with the drive.file scope and nothing else.
  expect(google.signIns).toHaveLength(1);
  const asked = Object.fromEntries(google.signIns[0]!.searchParams);
  expect(asked).toMatchObject({ client_id: E2E_GOOGLE_CLIENT_ID, response_type: 'token', scope: 'https://www.googleapis.com/auth/drive.file' });
  expect(asked.redirect_uri).toBe(new URL('/', page.url()).href);
  // Back on the same project, with the token gone from the address.
  await expect(page.getByTestId('project-menu')).toContainText('Orders drive');
  expect(page.url()).not.toContain('#');
  expect(page.url()).not.toContain('drive-token');

  // One file in a Puddle folder: the steps, never the rows or header values.
  const file = google.file();
  expect(file.name).toBe('orders-drive.puddle.json');
  expect(file.parents).toEqual([google.folder()!.id]);
  expect(file.description).toBe('Puddle project: Orders drive');
  expect(file.content).toContain('"customers.csv"');
  expect(file.content).not.toContain('PASTED-ROW-7');
  expect(file.content).not.toContain('Ada');
  expect(file.content).not.toContain('HEADER-SECRET-9');
  expect(file.content).toContain('"Authorization": ""');
  // The token lives in this tab's session only: never in IndexedDB, local storage or the file.
  const stored = await kept(page);
  expect(stored.idb).not.toContain('drive-token');
  expect(stored.local).not.toContain('drive-token');
  expect(stored.session).toContain('drive-token-1');
  expect(file.content).not.toContain('drive-token');
  // Every Drive call carried it.
  expect(google.requests.filter((r) => r.url.includes('googleapis.com/')).every((r) => r.auth === 'Bearer drive-token-1')).toBe(true);

  // A later change pushes once autosave settles, renaming the file with the project.
  await rename(page, 'Orders in Drive');
  await expect.poll(() => google.file().name).toBe('orders-in-drive.puddle.json');
  await expect(syncState(page)).toHaveAttribute('data-state', 'synced');
  expect(google.projectFiles()).toHaveLength(1);

  // Another browser signed in to the same Google account.
  const other = await browser.newContext();
  await google.route(other);
  const laptop = await other.newPage();
  await openApp(laptop);
  await projectMenu(laptop, 'All projects');
  await laptop.getByRole('button', { name: 'Open from Google Drive' }).click();
  await laptop.getByRole('dialog', { name: 'Open from Google Drive' }).getByRole('button', { name: 'Sign in with Google' }).click();
  // Back from Google, the list opens by itself.
  const dialog = laptop.getByRole('dialog', { name: 'Open from Google Drive' });
  await dialog.getByTestId('remote-Orders in Drive').getByRole('button', { name: 'Open' }).click();
  await expect(laptop.getByTestId('project-menu')).toContainText('Orders in Drive');
  await expect(node(laptop, 'customers.csv')).toBeVisible();
  await expect(node(laptop, 'Pasted data')).toBeVisible();
  await expect(syncState(laptop)).toHaveAttribute('data-state', 'synced');
  expect(laptop.url()).not.toContain('#');
  await other.close();

  // Disconnecting forgets the token here and asks Google to revoke it; the file stays in Drive.
  await projectMenu(page, 'Sync to Google Drive');
  await page.getByRole('dialog', { name: 'Sync to Google Drive' }).getByRole('button', { name: 'Disconnect Google Drive' }).click();
  await expect(syncState(page)).toHaveCount(0);
  await expect.poll(async () => (await kept(page)).session).not.toContain('drive-token');
  expect(google.revoked).toContain('drive-token-1');
  expect(google.projectFiles()).toHaveLength(1);
});

test('when the sign-in runs out, changes wait; signing in again lands on the same project and pushes them', async ({ page }) => {
  const google = mockGoogleDrive();
  await google.route(page.context());
  await openApp(page);
  await rename(page, 'Hour long');
  await startSyncing(page);

  google.expireTokens();
  await rename(page, 'Changed after an hour');
  await expect(syncState(page)).toHaveAttribute('data-state', 'error');
  await expect(syncState(page).locator('[title]')).toHaveAttribute('title', /Sign in to Google Drive again/);
  expect(google.file().content).not.toContain('Changed after an hour');

  await projectMenu(page, 'Sync to Google Drive');
  const dialog = page.getByRole('dialog', { name: 'Sync to Google Drive' });
  await expect(dialog.getByRole('button', { name: 'Sign in with Google' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Sign in again' }).click();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('project-menu')).toContainText('Changed after an hour');
  await expect.poll(() => google.file().content).toContain('Changed after an hour');
  await expect(syncState(page)).toHaveAttribute('data-state', 'synced');
  expect(google.signIns).toHaveLength(2);
  expect(google.projectFiles()).toHaveLength(1);
});

test('a conflicting edit in Drive waits for a choice', async ({ page }) => {
  const google = mockGoogleDrive();
  await google.route(page.context());
  await openApp(page);
  await rename(page, 'Shared drive');
  await startSyncing(page);

  google.editElsewhere((p) => ({ ...p, notes: 'Written on the laptop' }));
  await rename(page, 'Shared here');
  const banner = page.getByTestId('sync-conflict');
  await expect(banner).toContainText('the Google Drive version');
  await expect(syncState(page)).toHaveAttribute('data-state', 'conflict');
  expect(google.file().content).not.toContain('Shared here');

  await banner.getByRole('button', { name: 'Keep mine' }).click();
  await expect(syncState(page)).toHaveAttribute('data-state', 'synced');
  expect(google.file().content).toContain('"name": "Shared here"');
});

test('a sign-in refused on Google’s page says so and connects nothing', async ({ page }) => {
  const google = mockGoogleDrive();
  await google.route(page.context());
  await openApp(page);
  await rename(page, 'Not today');
  await projectMenu(page, 'All projects');
  google.denyNext();
  await page.getByRole('button', { name: 'Open from Google Drive' }).click();
  await page.getByRole('dialog', { name: 'Open from Google Drive' }).getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.getByTestId('home')).toContainText('Google Drive wasn’t connected: access wasn’t allowed.');
  expect(page.url()).not.toContain('#');
  expect(google.requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Open from Google Drive' }).click();
  await expect(page.getByRole('dialog', { name: 'Open from Google Drive' }).getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
});

test('an untouched new project is saved before leaving for Google, and syncs on coming back', async ({ page }) => {
  const google = mockGoogleDrive();
  await google.route(page.context());
  await openApp(page);
  const id = await page.evaluate(() => (globalThis.__puddle as unknown as { store: { getState(): { history: { present: { id: string } } } } }).store.getState().history.present.id);
  await startSyncing(page);
  const back = await page.evaluate(() => (globalThis.__puddle as unknown as { store: { getState(): { history: { present: { id: string } } } } }).store.getState().history.present.id);
  expect(back).toBe(id);
  expect(JSON.parse(google.file().content).id).toBe(id);
});
