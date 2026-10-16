import { expect, test, type Page } from '@playwright/test';
import { addFiles, fixture, node, openApp } from './helpers/app';

/** The open project's notes as IndexedDB holds them right now (autosave runs a moment after each change). */
const savedNotes = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const id = localStorage.getItem('puddle.lastProject');
        const req = indexedDB.open('puddle');
        req.onsuccess = () => {
          const db = req.result;
          if (!id || !db.objectStoreNames.contains('projects')) return resolve(null);
          const get = db.transaction('projects').objectStore('projects').get(id);
          get.onsuccess = () => resolve((get.result as { notes?: string } | undefined)?.notes ?? null);
          get.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      }),
  );

const NOTES = [
  '# Monthly orders',
  '',
  'Clean **orders** before the board pack. See [DuckDB docs](https://duckdb.org/docs).',
  '',
  '<script>window.__hacked = true</script>',
  '',
  '<img src="x" onerror="window.__hacked = true">',
  '',
  '[bad](javascript:window.__hacked=true)',
].join('\n');

const notesBox = (page: Page) => page.getByLabel('Project notes', { exact: true }).and(page.locator('textarea'));

test('project notes are written in Markdown, render safely, undo as one step and survive reload, export and import', async ({ page, browser }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Notes' }).click();
  await expect(page.getByTestId('notes-panel')).toBeVisible();
  await expect(page.getByTestId('inspector')).toHaveCount(0);

  // Typed key by key: one editing session, one undo step.
  await notesBox(page).click();
  await notesBox(page).pressSequentially('Draft');
  // Saved while still typing, even in a new project with nothing else in it yet.
  await expect.poll(() => savedNotes(page)).toBe('Draft');
  await notesBox(page).blur();
  await notesBox(page).fill(NOTES);
  await notesBox(page).blur();

  await page.getByRole('tab', { name: 'Preview' }).click();
  const preview = page.getByTestId('notes-preview');
  await expect(preview.getByRole('heading', { name: 'Monthly orders' })).toBeVisible();
  await expect(preview.locator('strong')).toHaveText('orders');
  const link = preview.getByRole('link', { name: 'DuckDB docs' });
  await expect(link).toHaveAttribute('href', 'https://duckdb.org/docs');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  // Script and HTML show as text, and nothing ran.
  await expect(preview).toContainText('<script>window.__hacked = true</script>');
  await expect(preview).toContainText('<img src="x" onerror="window.__hacked = true">');
  await expect(preview.locator('script, img, iframe')).toHaveCount(0);
  await expect(preview.getByRole('link', { name: 'bad' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __hacked?: boolean }).__hacked)).toBeUndefined();

  // Undo takes the whole second session back, then the first.
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('tab', { name: 'Write' }).click();
  await expect(notesBox(page)).toHaveValue('Draft');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(notesBox(page)).toHaveValue('');
  await page.getByRole('button', { name: 'Redo' }).click();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(notesBox(page)).toHaveValue(NOTES);

  // The project reopens with its notes.
  await expect.poll(() => savedNotes(page)).toBe(NOTES);
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Notes' }).click();
  await expect(page.getByTestId('notes-preview').getByRole('heading', { name: 'Monthly orders' })).toBeVisible();

  // Export, then import in a clean browser.
  const download = page.waitForEvent('download');
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Export project' }).click();
  const path = await (await download).path();
  const clean = await browser.newContext();
  const other = await clean.newPage();
  await openApp(other);
  await other.getByTestId('import-input').setInputFiles(path);
  await other.getByRole('button', { name: 'Notes' }).click();
  await expect(other.getByTestId('notes-preview')).toContainText('<script>window.__hacked = true</script>');
  await other.getByRole('tab', { name: 'Write' }).click();
  await expect(notesBox(other)).toHaveValue(NOTES);
  await clean.close();
});

test('source and output nodes take a note, marked on the canvas with the note on hover', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();

  await expect(node(page, 'customers.csv').getByTestId('node-note')).toHaveCount(0);
  await node(page, 'customers.csv').click();
  await page.getByLabel('Node notes').fill('Sent weekly by <b>finance</b>.');
  await page.getByLabel('Node notes').blur();
  const marker = node(page, 'customers.csv').getByTestId('node-note');
  await expect(marker).toHaveAttribute('title', 'Sent weekly by <b>finance</b>.');
  await marker.hover();

  await node(page, 'Output 1').click();
  await expect(page.getByTestId('inspector-output')).toBeVisible();
  await page.getByLabel('Node notes').fill('For the board pack.');
  await page.getByLabel('Node notes').blur();
  await expect(node(page, 'Output 1').getByTestId('node-note')).toHaveAttribute('title', 'For the board pack.');

  // Clearing a note removes the marker; undo brings it back.
  await page.getByLabel('Node notes').fill('');
  await page.getByLabel('Node notes').blur();
  await expect(node(page, 'Output 1').getByTestId('node-note')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(node(page, 'Output 1').getByTestId('node-note')).toHaveCount(1);

  // Opening the notes panel and then picking a node brings the inspector back.
  await page.getByRole('button', { name: 'Notes' }).click();
  await expect(page.getByTestId('notes-panel')).toBeVisible();
  await node(page, 'customers.csv').click();
  await expect(page.getByTestId('inspector-source')).toBeVisible();
  await expect(page.getByLabel('Node notes')).toHaveValue('Sent weekly by <b>finance</b>.');
});
