import { expect, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';
import { expectRows, node, openApp } from '../../e2e/helpers/app';

/** Where the pictures go: docs/_static/screenshots, unless DOCS_SCREENSHOTS_DIR says otherwise. */
const OUT = process.env.DOCS_SCREENSHOTS_DIR ?? join(import.meta.dirname, '../_static/screenshots');

/**
 * Save a screenshot for the docs as `<name>.png`: the whole window, or the part of it a locator covers with a little
 * room around it (only what is on screen, so a long menu is cut where the window cuts it). Animations are finished and
 * the text caret hidden first, so a rerun only changes a picture when the app itself changed.
 */
export async function shot(page: Page, name: string, target?: Locator, { pad = 8 }: { pad?: number } = {}) {
  // Let counts, wires and Fit View settle.
  await page.waitForTimeout(400);
  // A focus ring left on the last button clicked isn't part of the picture, unless a part of the page is the subject.
  if (!target) await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const options = { path: join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' } as const;
  if (!target) {
    await page.screenshot(options);
    return;
  }
  // The target can still be laying out, or sit outside the window for a moment after the window was resized: a clip
  // that is empty or off screen is measured again after it is brought into view.
  await expect(async () => {
    await target.scrollIntoViewIfNeeded();
    const box = (await target.boundingBox())!;
    const view = page.viewportSize()!;
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    const clip = { x, y, width: Math.min(view.width, box.x + box.width + pad) - x, height: Math.min(view.height, box.y + box.height + pad) - y };
    expect(clip.width).toBeGreaterThan(0);
    expect(clip.height).toBeGreaterThan(0);
    await page.screenshot({ ...options, clip });
  }).toPass({ timeout: 10_000, intervals: [300] });
}

/**
 * Number parts of the screen for a picture that explains the layout: a badge on each selector's element, centred at
 * a fraction of its width and height (somewhere with nothing under it), in the design system's accent colour. They
 * stay until the page reloads.
 */
export async function annotate(page: Page, parts: [selector: string, x: number, y: number][]) {
  await page.evaluate((list) => {
    list.forEach(([selector, x, y], i) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      if (!box) throw new Error(`Nothing to annotate at ${selector}`);
      const badge = document.createElement('div');
      badge.textContent = String(i + 1);
      badge.setAttribute('data-docs-annotation', '');
      Object.assign(badge.style, {
        position: 'fixed',
        left: `${box.left + box.width * x - 14}px`,
        top: `${Math.min(box.top + box.height * y - 14, innerHeight - 30)}px`,
        width: '28px',
        height: '28px',
        borderRadius: '999px',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--accent)',
        color: 'var(--on-accent)',
        font: '700 15px var(--font-sans, sans-serif)',
        boxShadow: '0 0 0 3px var(--accent-ring)',
        zIndex: '10000',
        pointerEvents: 'none',
      });
      document.body.append(badge);
    });
  }, parts);
}

/**
 * Save a part of the inspector or another scrolling panel whole: the window is made tall enough for it while the
 * picture is taken, then put back.
 */
export async function shotPanel(page: Page, name: string, target: Locator, { height = 1800 }: { height?: number } = {}) {
  const view = page.viewportSize()!;
  await page.setViewportSize({ width: view.width, height });
  await target.scrollIntoViewIfNeeded();
  await shot(page, name, target);
  await page.setViewportSize(view);
}

/** Open Puddle with the engine ready, as a returning visitor: the tour has been offered already. */
export async function start(page: Page, { tourOffer = false }: { tourOffer?: boolean } = {}) {
  if (!tourOffer) await page.addInitScript(() => localStorage.setItem('puddle.tour', JSON.stringify({ offered: true, stop: 0, finished: false })));
  await openApp(page);
}

const SAMPLES = {
  contacts: { name: 'Sample: contact list', files: ['contacts.csv'], rows: 53 },
  sales: { name: 'Sample: sales', files: ['sales.csv'], rows: undefined },
  orders: { name: 'Sample: orders and customers', files: ['orders.csv', 'customers.csv'], rows: undefined },
  monthly: { name: 'Sample: monthly sales', files: ['monthly-sales.csv'], rows: undefined },
} as const;

/** Open one of the built-in samples as a new project and wait until its sources have read. */
export async function openSample(page: Page, id: keyof typeof SAMPLES) {
  await page.getByRole('button', { name: 'Try a sample' }).first().click();
  await page.getByRole('dialog', { name: 'Try a sample' }).getByTestId(`sample-${id}`).click();
  const sample = SAMPLES[id];
  await expect(page.getByTestId('project-name')).toHaveText(sample.name, { ignoreCase: true });
  for (const f of sample.files) await expect(node(page, f)).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  if (sample.rows) await expectRows(page, sample.rows);
}

export const projectMenu = async (page: Page, item: string) => {
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: item }).click();
};

export const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
export const settings = (page: Page) => page.getByTestId('step-settings');

/**
 * Click column headers in the results grid (a canvas), by a point in pixels from the grid's left edge. Control adds
 * each later one to the selection.
 */
export async function selectColumnsAt(page: Page, ...xs: number[]) {
  const table = page.getByTestId('results-table');
  const box = (await table.boundingBox())!;
  for (const [k, x] of xs.entries()) {
    if (k) await page.keyboard.down('Control');
    await page.mouse.click(box.x + x, box.y + 20);
    if (k) await page.keyboard.up('Control');
  }
}

/** A picture of one area of the window, for a subject that is part of a larger element. */
export async function shotClip(page: Page, name: string, clip: { x: number; y: number; width: number; height: number }) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${name}.png`), clip, animations: 'disabled', caret: 'hide' });
}
