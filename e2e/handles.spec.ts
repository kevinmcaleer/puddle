import { expect, test, type Page } from '@playwright/test';
import { fixtureText, node, openApp } from './helpers/app';

// Keeping file handles between visits needs showOpenFilePicker, which only Chromium browsers have. Elsewhere Puddle
// says so and asks for the file again: e2e/browsers.spec.ts tests that in every browser.
test.skip(({ browserName }) => browserName !== 'chromium', 'Only Chromium keeps file handles; browsers.spec.ts covers the others.');

/**
 * Chromium's file picker can't be driven by Playwright, so these tests stand in for it: files are written to the
 * origin private file system and the picker hands back their real FileSystemFileHandles, which the app stores in
 * IndexedDB and reopens after a reload exactly as it would handles to files on disk. Permission is stubbed on
 * FileSystemHandle's prototype (OPFS handles are always granted), so the click-to-allow path runs:
 * - `localStorage['test.deny']`: names whose permission request is refused;
 * - `window.__requests`: how many permission requests were made.
 */
async function withFilePicker(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __pick: string[]; __requests: number; showOpenFilePicker: () => Promise<FileSystemFileHandle[]> };
    w.__pick = [];
    w.__requests = 0;
    w.showOpenFilePicker = async () => {
      const dir = await navigator.storage.getDirectory();
      const names = w.__pick;
      w.__pick = [];
      if (!names.length) throw new DOMException('The user aborted a request.', 'AbortError');
      return Promise.all(names.map((n) => dir.getFileHandle(n)));
    };
    const proto = FileSystemHandle.prototype as unknown as Record<string, (this: FileSystemHandle) => Promise<PermissionState>>;
    proto.queryPermission = async () => 'prompt';
    proto.requestPermission = async function () {
      w.__requests++;
      const deny = JSON.parse(localStorage.getItem('test.deny') ?? '[]') as string[];
      return deny.includes(this.name) ? 'denied' : 'granted';
    };
  });
  await openApp(page, { fileSystemAccess: true });
}

/** Put fixture files where the stand-in picker finds them, as though they sat on disk. */
const writeFiles = (page: Page, names: string[]) =>
  page.evaluate(
    async (files) => {
      const dir = await navigator.storage.getDirectory();
      for (const [name, text] of files) {
        const h = await dir.getFileHandle(name, { create: true });
        const out = await h.createWritable();
        await out.write(text);
        await out.close();
      }
    },
    names.map((n) => [n, fixtureText(n)] as const),
  );

/** Choose files through the toolbar, the way a person would, with no file dialog for Playwright to fill. */
async function chooseFiles(page: Page, names: string[]) {
  await page.evaluate((n) => ((window as unknown as { __pick: string[] }).__pick = n), names);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Choose files/ }).click();
}

/** How many file handles IndexedDB holds for the open project, or for one named. */
const storedHandles = (page: Page, projectId?: string) =>
  page.evaluate(
    (id) =>
      new Promise<number>((resolve) => {
        const pid = id ?? localStorage.getItem('puddle.lastProject');
        const req = indexedDB.open('puddle');
        req.onsuccess = () => {
          const db = req.result;
          if (!pid || !db.objectStoreNames.contains('handles')) return resolve(0);
          const count = db.transaction('handles').objectStore('handles').index('projectId').count(pid);
          count.onsuccess = () => resolve(count.result);
        };
      }),
    projectId,
  );

/** How many sources the saved copy of the open project has (autosave runs a moment after each change). */
const savedSources = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const id = localStorage.getItem('puddle.lastProject');
        const req = indexedDB.open('puddle');
        req.onsuccess = () => {
          if (!id) return resolve(0);
          const get = req.result.transaction('projects').objectStore('projects').get(id);
          get.onsuccess = () => resolve((get.result as { sources?: unknown[] } | undefined)?.sources?.length ?? 0);
        };
      }),
  );

const projectId = (page: Page) => page.evaluate(() => (globalThis.__puddle as unknown as { store: { getState(): { history: { present: { id: string } } } } }).store.getState().history.present.id);

async function reload(page: Page) {
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
}

test('a reopened project reconnects all its files with one click and no file dialog', async ({ page }) => {
  let dialogs = 0;
  page.on('filechooser', () => dialogs++);
  await withFilePicker(page);
  await writeFiles(page, ['customers.csv', 'dates.csv']);
  await chooseFiles(page, ['customers.csv', 'dates.csv']);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  await expect(node(page, 'dates.csv')).toHaveAttribute('data-status', 'ok');
  await expect.poll(() => storedHandles(page)).toBe(2);
  await expect.poll(() => savedSources(page)).toBe(2);
  // The project file stays portable: no handle in it.
  const saved = await page.evaluate(() => JSON.stringify((globalThis.__puddle as unknown as { store: { getState(): { history: { present: unknown } } } }).store.getState().history.present));
  expect(saved).not.toContain('handle');

  await reload(page);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'detached');
  const banner = page.getByTestId('reconnect-banner');
  await expect(banner).toContainText('Puddle can open customers.csv and dates.csv again once you allow it.');
  await banner.getByRole('button', { name: 'Reconnect 2 files' }).click();

  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  await expect(node(page, 'dates.csv')).toHaveAttribute('data-status', 'ok');
  await expect(banner).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __requests: number }).__requests)).toBe(2);
  await node(page, 'customers.csv').click();
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-rows', '4', { timeout: 20_000 });
  await expect(page.getByTestId('attachment-banner')).toHaveCount(0);
  expect(dialogs).toBe(0);
});

test('a refused permission or a moved file falls back to choosing the file, with the reason', async ({ page }) => {
  await withFilePicker(page);
  await writeFiles(page, ['customers.csv', 'dates.csv']);
  await chooseFiles(page, ['customers.csv', 'dates.csv']);
  await expect(node(page, 'dates.csv')).toHaveAttribute('data-status', 'ok');
  await expect.poll(() => storedHandles(page)).toBe(2);
  await expect.poll(() => savedSources(page)).toBe(2);

  // dates.csv goes away; reading customers.csv is refused.
  await page.evaluate(async () => {
    await (await navigator.storage.getDirectory()).removeEntry('dates.csv');
    localStorage.setItem('test.deny', JSON.stringify(['customers.csv']));
  });
  await reload(page);
  await page.getByRole('button', { name: 'Reconnect 2 files' }).click();
  await expect(page.getByTestId('reconnect-banner')).toHaveCount(0);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'detached');
  await expect(node(page, 'dates.csv')).toHaveAttribute('data-status', 'detached');

  await node(page, 'dates.csv').click();
  await expect(page.getByTestId('attachment-banner')).toContainText('dates.csv isn’t where it was. It may have been moved, renamed or deleted; choose it again.');
  await node(page, 'customers.csv').click();
  await expect(page.getByTestId('attachment-banner')).toContainText('Permission to read customers.csv was refused. Choose it again.');
  await expect(page.getByTestId('results-detached')).toContainText('Permission to read customers.csv was refused.');

  // Choosing it again works as before, and keeps the new handle for next time.
  await page.evaluate(() => ((window as unknown as { __pick: string[] }).__pick = ['customers.csv']));
  await page.getByTestId('results-detached').getByRole('button', { name: 'Choose file' }).click();
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('attachment-banner')).toHaveCount(0);
});

test('a duplicated project reconnects the same way; deleting a project forgets its handles', async ({ page }) => {
  await withFilePicker(page);
  await writeFiles(page, ['customers.csv']);
  await chooseFiles(page, ['customers.csv']);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  await expect.poll(() => storedHandles(page)).toBe(1);
  const original = await projectId(page);

  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'All projects' }).click();
  await page.getByRole('button', { name: 'More for Untitled project' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await page.getByTestId('project-Untitled project copy').getByRole('button').first().click();
  // Opening a project is asynchronous: wait for the copy to be the open project before reading its id.
  await expect(page.getByTestId('project-name')).toHaveText('Untitled project copy');
  const copy = await projectId(page);
  expect(copy).not.toBe(original);
  await expect.poll(() => storedHandles(page, copy)).toBe(1);
  // Files chosen in this tab stay connected; a fresh visit reconnects the copy through its own handles.
  await reload(page);
  await expect(page.getByTestId('project-name')).toHaveText('Untitled project copy');
  await page.getByRole('button', { name: 'Reconnect 1 file' }).click();
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');

  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'All projects' }).click();
  await page.getByRole('button', { name: 'More for Untitled project copy' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete project?' }).getByRole('button', { name: 'Delete project' }).click();
  await expect(page.getByTestId('project-Untitled project copy')).toHaveCount(0);
  expect(await storedHandles(page, copy)).toBe(0);
  expect(await storedHandles(page, original)).toBe(1);
});

test('an imported project has no handles and falls back to choosing files', async ({ page }) => {
  await withFilePicker(page);
  await page.getByTestId('import-input').setInputFiles({
    name: 'shared.puddle.json',
    mimeType: 'application/json',
    buffer: Buffer.from(fixtureText('projects/v1.puddle.json')),
  });
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'detached');
  await expect(page.getByTestId('reconnect-banner')).toHaveCount(0);
});

test('a dropped file is still added when the browser keeps handles', async ({ page }) => {
  await withFilePicker(page);
  const canvas = page.getByTestId('canvas');
  const drop = await page.evaluateHandle((t) => {
    const dt = new DataTransfer();
    dt.items.add(new File([t], 'dropped.csv', { type: 'text/csv' }));
    return dt;
  }, fixtureText('customers.csv'));
  await canvas.dispatchEvent('dragover', { dataTransfer: drop });
  await canvas.dispatchEvent('drop', { dataTransfer: drop, clientX: 400, clientY: 300 });
  await expect(node(page, 'dropped.csv')).toHaveAttribute('data-status', 'ok');
});
