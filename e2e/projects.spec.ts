import { expect, test, type Page } from '@playwright/test';
import { addFiles, cell, expectRows, fixture, node, openApp, pasteText, saved } from './helpers/app';

const projectMenu = async (page: Page, item: string) => {
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: item }).click();
};

test('closing and reopening the tab restores the project, the canvas viewport and the view', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  await page.getByRole('button', { name: 'Zoom In' }).click();
  await expect.poll(async () => (await saved(page))?.view.canvasViewport.zoom ?? 0).toBeGreaterThan(1);
  const zoom = (await saved(page))!.view.canvasViewport.zoom;

  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'detached');
  const restored = await page.evaluate(() => (globalThis.__puddle as unknown as { store: { getState(): { history: { present: { view: { canvasViewport: { zoom: number } } } } } } }).store.getState().history.present.view);
  expect(restored.canvasViewport.zoom).toBe(zoom);
  await expect(page.getByTestId('results-title')).toHaveText('customers.csv');
  await expect(page.getByTestId('results-detached')).toContainText('choose customers.csv again');

  // Choosing the same file again reconnects it, with no warning.
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('results-detached').getByRole('button', { name: 'Choose file' }).click();
  await (await chooser).setFiles(fixture('customers.csv'));
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  await expectRows(page, 4);
  await node(page, 'customers.csv').click();
  await expect(page.getByTestId('attachment-banner')).toHaveCount(0);
});

test('choosing a different file than the project was built on warns', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect.poll(async () => (await saved(page))?.nodes.length).toBe(1);
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await node(page, 'customers.csv').click();
  await expect(page.getByTestId('attachment-banner')).toHaveAttribute('data-state', 'detached');

  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('attachment-banner').getByRole('button', { name: 'Choose file' }).click();
  await (await chooser).setFiles(fixture('semicolon.csv'));
  await expect(page.getByTestId('attachment-banner')).toHaveAttribute('data-state', 'mismatch');
  await expect(page.getByTestId('attachment-banner')).toContainText('This file looks different');
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
});

test('pasted data is stored in the project and comes back connected', async ({ page }) => {
  await openApp(page);
  await pasteText(page, 'sku\tqty\nA1\t3\nB2\t5\n');
  await expect(node(page, 'Pasted data')).toHaveAttribute('data-status', 'ok');
  await expect.poll(async () => (await saved(page))?.nodes.length).toBe(1);
  await page.reload();
  await expect(node(page, 'Pasted data')).toHaveAttribute('data-status', 'ok', { timeout: 45_000 });
  await expectRows(page, 2);
  await expect(cell(page, 0, 1)).toHaveText('B2');
});

test('projects can be created, renamed, duplicated and deleted from the home screen', async ({ page }) => {
  await openApp(page);
  // A first project with something in it, so it is saved.
  await addFiles(page, [fixture('customers.csv')]);
  await projectMenu(page, 'Rename');
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Customers');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByTestId('project-name')).toHaveText('Customers');

  await projectMenu(page, 'All projects');
  const home = page.getByTestId('home');
  await expect(home).toContainText('Nothing leaves your browser. Projects save the steps, not the data.');
  await expect(page.getByTestId('project-Customers')).toContainText('1 source · 1 node');

  await page.getByRole('button', { name: 'More for Customers' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByTestId('project-Customers copy')).toBeVisible();

  // Delete asks first; cancelling keeps the project.
  await page.getByRole('button', { name: 'More for Customers copy' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete project?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('project-Customers copy')).toBeVisible();
  await page.getByRole('button', { name: 'More for Customers copy' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete project' }).click();
  await expect(page.getByTestId('project-Customers copy')).toHaveCount(0);

  // A new project opens empty; going home lists both once it has content.
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByTestId('project-name')).toHaveText('Untitled project');
  await expect(page.getByRole('heading', { name: 'Start with a source' })).toBeVisible();
  await projectMenu(page, 'All projects');
  await page.getByTestId('project-Customers').getByRole('button').first().click();
  await expect(page.getByTestId('project-name')).toHaveText('Customers');
  await expect(node(page, 'customers.csv')).toBeVisible();

  // Reloading from the home screen stays on the home screen.
  await projectMenu(page, 'All projects');
  await expect(page.getByTestId('home')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('home')).toBeVisible();
});

test('an exported project imports in a clean browser and re-runs once its file is chosen', async ({ page, browser }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  await projectMenu(page, 'Rename');
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Shared project');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const download = page.waitForEvent('download');
  await projectMenu(page, 'Export project');
  const file = await download;
  expect(file.suggestedFilename()).toBe('shared-project.puddle.json');
  const path = await file.path();

  const clean = await browser.newContext();
  const other = await clean.newPage();
  await openApp(other);
  await other.getByTestId('project-menu').click();
  await other.getByRole('menuitem', { name: 'Import project' }).click();
  await other.getByTestId('import-input').setInputFiles(path);
  await expect(other.getByTestId('project-name')).toHaveText('Shared project');
  await expect(node(other, 'customers.csv')).toHaveAttribute('data-status', 'detached');

  const chooser = other.waitForEvent('filechooser');
  await other.getByTestId('results-detached').getByRole('button', { name: 'Choose file' }).click();
  await (await chooser).setFiles(fixture('customers.csv'));
  await expectRows(other, 4);
  await clean.close();
});

test('a project from an older format opens through migration', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('import-input').setInputFiles(fixture('projects/unversioned.puddle.json'));
  await expect(page.getByTestId('project-name')).toHaveText('Customers clean-up (old format)');
  await expect(node(page, 'Pasted data')).toHaveAttribute('data-status', 'ok');
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'detached');
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'blocked');
});

test('a project from a newer Puddle is refused with a reason', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('import-input').setInputFiles({
    name: 'future.puddle.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ id: 'f', name: 'Future', formatVersion: 99 })),
  });
  await expect(page.getByTestId('canvas-notice')).toContainText('saved by a newer version of Puddle');
});

test('project settings are saved with the project', async ({ page }) => {
  await openApp(page);
  await page.getByLabel('Locale').selectOption({ label: 'German' });
  await expect.poll(async () => (await saved(page))?.settings.locale).toBe('de-DE');
  await page.reload();
  await expect(page.getByLabel('Locale')).toHaveValue('de-DE');
});

test('a Source to Transform to Output flow is saved and reloaded with its layout', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await expect.poll(async () => (await saved(page))?.nodes.length).toBe(3);
  const positions = () =>
    page.evaluate(() =>
      (globalThis.__puddle as unknown as { store: { getState(): { history: { present: { nodes: Array<{ name: string; position: unknown }> } } } } }).store
        .getState()
        .history.present.nodes.map((n) => [n.name, n.position]),
    );
  await expect.poll(async () => JSON.stringify((await saved(page))?.nodes.map((n) => [(n as { name: string }).name, (n as { position: unknown }).position]))).toBe(JSON.stringify(await positions()));
  const before = await positions();

  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  expect(await positions()).toEqual(before);
  await expect(page.getByTestId('wire-customers.csv->Transform 1')).toBeAttached();
  await expect(page.getByTestId('wire-Transform 1->Output 1')).toBeAttached();
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'blocked');
});

// Regression: leaving for the home screen forgot the open project only after saving, so a reload in between
// reopened the project instead of the home screen.
test('the home screen is remembered the moment you leave a project', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect.poll(async () => (await saved(page))?.nodes.length).toBe(1);
  await page.getByTestId('project-menu').click();
  const remembered = await page.evaluate(() => {
    (Array.from(document.querySelectorAll('[role=menuitem]')).find((el) => el.textContent?.includes('All projects')) as HTMLElement).click();
    return localStorage.getItem('puddle.lastProject');
  });
  expect(remembered).toBeNull();
  await page.reload();
  await expect(page.getByTestId('home')).toBeVisible();
});
