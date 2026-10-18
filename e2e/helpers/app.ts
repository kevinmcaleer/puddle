import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const fixture = (name: string) => join(import.meta.dirname, '../../tests/fixtures', name);

/**
 * Add a step to the selected Transform from the Add step menu, and wait until it is in the step list (and so selected
 * and shown in the step settings). The menu builds the step before adding it, which can read the data first: until
 * then the settings still show the step before, and a click meant for the new step would change that one.
 */
export async function addStep(page: Page, title: string) {
  const steps = page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
  const before = await steps.count();
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${title}`) }).click();
  await expect(steps).toHaveCount(before + 1);
}
export const fixtureText = (name: string) => readFileSync(fixture(name), 'utf8');

/**
 * Add a step from the toolbar's Add menu: a Transform node of its own after the selected node (`name` is what it is
 * called), selected and shown in the inspector once it is in.
 */
export async function addStepNode(page: Page, title: string, name = 'Transform 1') {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${title}`) }).click();
  await expect(node(page, name)).toBeVisible();
  await expect(page.getByLabel('Node name')).toHaveValue(name);
}

/** Turn off the project setting that gives each new step a node of its own, so steps stack into the viewed Transform. */
export async function stackSteps(page: Page) {
  await page.getByRole('tab', { name: 'Project' }).click();
  const setting = page.getByRole('switch', { name: 'Add each step as a new node' });
  await expect(setting).toHaveAttribute('aria-checked', 'true');
  await setting.click();
  await expect(setting).toHaveAttribute('aria-checked', 'false');
}

/** T opens the Add menu with its search focused; typing a step's title and Enter adds it as a node after the selected one. */
export async function addStepWithT(page: Page, title: string, name = 'Transform 1') {
  await page.keyboard.press('t');
  const search = page.getByLabel('Search steps and nodes');
  await expect(search).toBeFocused();
  await search.fill(title);
  await search.press('Enter');
  await expect(node(page, name)).toBeVisible();
  await expect(page.getByLabel('Node name')).toHaveValue(name);
}

/**
 * With E2E_BROWSER_LOGS set (CI does), print the page's errors, warnings and failed requests, including the engine
 * worker's, into the test output: the job log then says why a browser misbehaved without the trace.
 */
function logBrowserTrouble(page: Page) {
  page.on('console', (m) => {
    // The suite blocks the service worker on purpose (see playwright.config.ts), so that warning is left out.
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().startsWith('Service Worker registration blocked')) console.log(`[browser ${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  page.on('requestfailed', (r) => console.log(`[request failed] ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('crash', () => console.log('[page crashed]'));
  page.on('worker', (w) => w.on('close', () => console.log(`[worker closed] ${w.url()}`)));
}

/**
 * Open the app and wait for DuckDB, which every data flow needs.
 *
 * Chromium's own file picker (`showOpenFilePicker`) can't be driven by Playwright: with a file chooser being
 * awaited it rejects at once, and no `filechooser` event fires. So by default the app runs without it and chooses
 * files through `<input type="file">`, which is also how Firefox and WebKit always work. The file handle specs pass
 * `fileSystemAccess: true` and install their own picker over the origin private file system.
 */
export async function openApp(page: Page, { fileSystemAccess = false }: { fileSystemAccess?: boolean } = {}) {
  if (process.env.E2E_BROWSER_LOGS) logBrowserTrouble(page);
  if (!fileSystemAccess) await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true }));
  await open(page);
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
}

/**
 * Go to the app. Only the document is waited for, not `load`: the engine wait that follows is what matters, and in
 * WebKit the load event now and then never fires on a fresh page (about one start in a hundred in CI), which used
 * to time the whole test out. A start that still hangs is tried once more.
 */
async function open(page: Page) {
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  } catch (e) {
    console.log(`[open] the first navigation didn't finish (${(e as Error).message.split('\n')[0]}); trying once more`);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  }
}

/** Add files through the toolbar's Add source menu and the system file chooser. */
export async function addFiles(page: Page, files: string[] | { name: string; mimeType: string; buffer: Buffer }[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Choose files/ }).click();
  await (await chooser).setFiles(files);
}

export const node = (page: Page, name: string) => page.getByTestId(`node-${name}`);

/** The rows the results table says it has, once the background count lands. */
export async function expectRows(page: Page, rows: number) {
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-rows', String(rows), { timeout: 20_000 });
}

/** Read the viewed result's first rows the way the grid gets them, through the store and engine. */
export async function columnsOf(page: Page, nodeName: string): Promise<string[]> {
  await expect(node(page, nodeName)).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, nodeName).click();
  return page.getByTestId('inspector-columns').locator('.ui-col').allTextContents();
}

/** A visible results cell by data column and row (both from 0), as Glide mirrors it for screen readers. */
export const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);

/** The open project as IndexedDB holds it right now (autosave runs a moment after each change). */
export const saved = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ name: string; nodes: unknown[]; view: { canvasViewport: { zoom: number } }; settings: { locale: string } } | null>((resolve) => {
        const id = localStorage.getItem('puddle.lastProject');
        const req = indexedDB.open('puddle');
        req.onsuccess = () => {
          const db = req.result;
          if (!id || !db.objectStoreNames.contains('projects')) return resolve(null);
          const get = db.transaction('projects').objectStore('projects').get(id);
          get.onsuccess = () => resolve(get.result ?? null);
          get.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      }),
  );

/**
 * Fit the canvas to its nodes and wait until `name` sits wholly inside it and has stopped moving. A node added below
 * the visible canvas can't be clicked where it is: Playwright scrolls the canvas to reach it, React Flow scrolls it
 * straight back, and in Firefox the click then lands on the pane. A person would bring it into view first, too.
 * Fit View fits the nodes as they are; one still growing (its counts arriving) can end a few pixels past the edge,
 * so it is fitted again until the node is inside and still.
 */
export async function bringIntoView(page: Page, name: string) {
  let last = '';
  await expect(async () => {
    await page.getByRole('button', { name: 'Fit View' }).click();
    const canvas = (await page.getByTestId('canvas').boundingBox())!;
    const box = (await node(page, name).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(canvas.y);
    expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height);
    expect(box.x).toBeGreaterThanOrEqual(canvas.x);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    const now = JSON.stringify(box);
    const before = last;
    last = now;
    expect(now).toBe(before);
  }).toPass({ intervals: [150] });
}

/**
 * Paste text onto the page as the system clipboard would. Firefox's ClipboardEvent constructor ignores the
 * `clipboardData` it is given, so the event carries it as its own property, which every browser honours.
 */
export const pasteText = (page: Page, text: string) =>
  page.evaluate((t) => {
    const data = new DataTransfer();
    data.setData('text/plain', t);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    window.dispatchEvent(event);
  }, text);
