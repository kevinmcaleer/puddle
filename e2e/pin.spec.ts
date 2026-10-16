import { expect, test, type Page } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp } from './helpers/app';

const title = (page: Page) => page.getByTestId('results-title');

/** Orders and customers on the canvas, joined into Join 1. */
async function joinShop(page: Page) {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv'), fixture('shop-customers.csv')]);
  await expect(node(page, 'shop-customers.csv')).toHaveAttribute('data-status', 'ok');
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok');
  await node(page, 'shop-orders.csv').click();
  await node(page, 'shop-customers.csv').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: /Join/ }).click();
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'ok');
}

/** The project as last saved in the browser. */
const savedView = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ pinned?: boolean; compare?: { nodeId: string } } | null>((resolve) => {
        const id = localStorage.getItem('puddle.lastProject');
        const req = indexedDB.open('puddle');
        req.onsuccess = () => {
          const db = req.result;
          if (!id || !db.objectStoreNames.contains('projects')) return resolve(null);
          const get = db.transaction('projects').objectStore('projects').get(id);
          get.onsuccess = () => resolve(get.result?.view ?? null);
          get.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      }),
  );

test('a pinned table stays put while other nodes are clicked, and follows clicks again once unpinned', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv'), fixture('shop-customers.csv')]);
  await expect(node(page, 'shop-customers.csv')).toHaveAttribute('data-status', 'ok');
  await node(page, 'shop-orders.csv').click();
  await expect(title(page)).toHaveText('shop-orders.csv');
  await expectRows(page, 5);

  const pin = page.getByTestId('pin-toggle');
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('results-panel').locator('.ui-pinned')).toHaveText('Pinned');
  await expect(node(page, 'shop-orders.csv').getByTestId('node-pill')).toHaveText('Pinned');

  // Clicking another node selects it (the inspector follows) but the table stays on orders.
  await node(page, 'shop-customers.csv').click();
  await expect(page.getByTestId('inspector-columns').locator('.ui-col')).toHaveText(['customer_id', 'name', 'status']);
  await expect(title(page)).toHaveText('shop-orders.csv');
  await expectRows(page, 5);
  await expect(page.getByTestId('pin-offer')).toContainText('shop-customers.csv is selected.');

  // P unpins (outside text fields); the next click is followed again.
  await page.keyboard.press('p');
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('pin-offer')).not.toBeAttached();
  await expect(node(page, 'shop-orders.csv').getByTestId('node-pill')).toHaveText('Viewing');
  await node(page, 'shop-customers.csv').click();
  await expect(title(page)).toHaveText('shop-customers.csv');
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', 'customer_id,name,status');

  // P pins again; View here moves the pin to the selected node.
  await page.keyboard.press('p');
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await node(page, 'shop-orders.csv').click();
  await expect(title(page)).toHaveText('shop-customers.csv');
  await page.getByTestId('pin-offer').getByRole('button', { name: 'View here' }).click();
  await expect(title(page)).toHaveText('shop-orders.csv');
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await expectRows(page, 5);

  // Typing P into a field doesn't pin or unpin.
  await page.getByTestId('notes-toggle').click();
  await page.getByLabel('Project notes', { exact: true }).and(page.locator('textarea')).click();
  await page.keyboard.type('p');
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
});

test('comparing a source with the Join after it: two grids, each with its own counts, and the extra columns marked', async ({ page }) => {
  await joinShop(page);
  await node(page, 'shop-orders.csv').click();
  await page.getByTestId('pin-toggle').click();
  await node(page, 'Join 1').click();
  await page.getByTestId('pin-offer').getByRole('button', { name: 'Compare' }).click();

  const compare = page.getByTestId('results-compare');
  await expect(compare).toBeVisible();
  await expect(compare.getByTestId('pane-title')).toHaveText(['shop-orders.csv', 'Join 1']);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-rows', '5', { timeout: 20_000 });
  await expect(page.getByTestId('results-table-compare')).toHaveAttribute('data-rows', '6', { timeout: 20_000 });
  await expect(page.getByTestId('pane-strip-main').locator('.ui-strip')).toContainText('5 rows');
  await expect(page.getByTestId('pane-strip-main').locator('.ui-strip')).toContainText('4 cols');
  await expect(page.getByTestId('pane-strip-compare').locator('.ui-strip')).toContainText('6 rows');
  await expect(page.getByTestId('pane-strip-compare').locator('.ui-strip')).toContainText('6 cols');

  // Join 1 has the customer's name and status besides the order's columns; orders has nothing Join 1 lacks.
  await expect(page.getByTestId('results-table-compare')).toHaveAttribute('data-only-columns', 'name,status_right');
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-only-columns', '');
  await expect(node(page, 'Join 1').getByTestId('node-pill')).toHaveText('Comparing');
  await expect(node(page, 'shop-orders.csv').getByTestId('node-pill')).toHaveText('Pinned');
  await expect(page.getByTestId('pin-offer')).not.toBeAttached();

  // The status strip under the canvas still speaks for the pinned node.
  await expect(page.locator('.ui-strip').last()).toContainText('5 rows');

  // Pinned and comparing are saved with the project, and not undo steps.
  await expect.poll(async () => (await savedView(page))?.compare?.nodeId).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('pin-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('results-compare').getByTestId('pane-title')).toHaveText(['shop-orders.csv', 'Join 1']);
  await expect(node(page, 'Join 1').getByTestId('node-pill')).toHaveText('Comparing');

  // Stop comparing; the table stays pinned.
  await page.getByRole('button', { name: 'Stop comparing' }).click();
  await expect(page.getByTestId('results-compare')).not.toBeAttached();
  await expect(page.getByTestId('pin-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await savedView(page))?.compare).toBeUndefined();
});

test('undo leaves the pin and the comparison alone', async ({ page }) => {
  await joinShop(page);
  await node(page, 'shop-orders.csv').click();
  await page.getByTestId('pin-toggle').click();
  await node(page, 'Join 1').click();
  await page.getByTestId('pin-offer').getByRole('button', { name: 'Compare' }).click();
  await expect(page.getByTestId('results-compare')).toBeVisible();

  // Undo the Join type change: the comparison stays.
  await page.getByTestId('inspector-join').getByLabel('Join type').selectOption({ label: 'Inner join' });
  await expect(page.getByTestId('results-table-compare')).toHaveAttribute('data-rows', '5', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('results-table-compare')).toHaveAttribute('data-rows', '6', { timeout: 20_000 });
  await expect(page.getByTestId('pin-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('results-compare').getByTestId('pane-title')).toHaveText(['shop-orders.csv', 'Join 1']);
});

/** A wide, long CSV, so both grids can scroll both ways. */
function wide(rows = 400, cols = 14) {
  const header = ['id', ...Array.from({ length: cols - 1 }, (_, i) => `column_${i + 1}`)];
  const lines = Array.from({ length: rows }, (_, r) => [r + 1, ...header.slice(1).map((_, c) => `r${r + 1}c${c + 1}`)].join(','));
  return { name: 'wide.csv', mimeType: 'text/csv', buffer: Buffer.from([header.join(','), ...lines].join('\n')) };
}

/**
 * Scroll with the wheel in notches of at most 300px. Firefox scrolls a single wheel event by at most a page of the
 * grid, so one big event moves it only a few rows there; the same distance in notches scrolls alike everywhere.
 */
async function wheel(page: Page, dx: number, dy: number) {
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 300);
  for (let i = 0; i < steps; i++) await page.mouse.wheel(dx / steps, dy / steps);
}

/** wide.csv and a Transform after it, compared side by side: the two grids, and a check that they show the same spot. */
async function compareWide(page: Page) {
  await openApp(page);
  await addFiles(page, [wide()]);
  await expect(node(page, 'wide.csv')).toHaveAttribute('data-status', 'ok');
  await node(page, 'wide.csv').click();
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  await node(page, 'wide.csv').click();
  await page.getByTestId('pin-toggle').click();
  await node(page, 'Transform 1').click();
  await page.getByTestId('pin-offer').getByRole('button', { name: 'Compare' }).click();

  const main = page.getByTestId('results-table');
  const other = page.getByTestId('results-table-compare');
  await expect(main).toHaveAttribute('data-rows', '400', { timeout: 20_000 });
  await expect(other).toHaveAttribute('data-rows', '400', { timeout: 20_000 });

  // Where each grid is scrolled to, once both have settled on the same spot.
  const spot = async (attr: string) => [await main.getAttribute(attr), await other.getAttribute(attr)];
  const together = (attr: string) => expect.poll(async () => { const [a, b] = await spot(attr); return a === b ? a : `${a} vs ${b}`; }, { timeout: 10_000 });
  return { main, other, together };
}

test('compared grids scroll together, by row and by matching column', async ({ page }) => {
  const { main, other, together } = await compareWide(page);

  // Scroll the left grid down: the right one follows to the same row.
  const box = (await main.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await wheel(page, 0, 1500);
  await expect.poll(async () => Number(await main.getAttribute('data-first-row'))).toBeGreaterThan(10);
  await together('data-first-row').toMatch(/^[1-9]\d*$/);
  // WebKit scrolls the wheel off the page's own thread, so the left grid can still be on its way: wait until it stays
  // on one row before taking it as where the person left it.
  let last = '';
  await expect
    .poll(
      async () => {
        const now = (await main.getAttribute('data-first-row')) ?? '';
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [300] },
    )
    .toBe(true);
  await together('data-first-row').toBe(last);
  const down = Number(last);

  // The grid that follows can keep moving after the person stops, as Firefox's smooth scrolling does. Regression:
  // those late moves were passed back once a short window after following had closed, so the grids took turns
  // following each other and came to rest on different rows. Only the grid the person scrolled leads.
  await page.waitForTimeout(400);
  await other.locator('.dvn-scroller').evaluate((el) => el.scrollBy({ top: 2000 }));
  await expect.poll(async () => Number(await other.getAttribute('data-first-row'))).toBeGreaterThan(down);
  await page.waitForTimeout(400);
  expect(Number(await main.getAttribute('data-first-row'))).toBe(down);

  // Scroll it sideways: the right one shows the same column at its left edge.
  await wheel(page, 600, 0);
  await expect.poll(async () => (await main.getAttribute('data-first-column')) ?? '').toMatch(/^column_/);
  await together('data-first-column').toMatch(/^column_/);

  // And the other way round, straight after the right grid followed the left one. Regression: a scroll that came
  // soon after following was taken for the follow's echo and never reached the other grid.
  const right = (await other.boundingBox())!;
  await wheel(page, 0, 120);
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2);
  await wheel(page, 0, -900);
  await expect.poll(async () => Number(await other.getAttribute('data-first-row'))).toBeLessThan(down);
  await together('data-first-row').toMatch(/^\d+$/);
  expect(Number(await main.getAttribute('data-first-row'))).toBeLessThan(down);
});

test('a grid that follows lands on the same row and column when the browser rounds where it scrolls to', async ({ page }) => {
  // Regression (WebKit): the following grid is scrolled to the other's spot by a distance measured on screen, which
  // can come out a fraction of a pixel short. It then showed the row above ("53 vs 52"). Here every scroll the app
  // makes lands 0.6px short, as a browser rounding that distance down would.
  await page.addInitScript(() => {
    const top = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get: top.get,
      set(this: Element, value: number) {
        top.set!.call(this, this.classList.contains('dvn-scroller') ? value - 0.6 : value);
      },
    });
    const scrollTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function (this: Element, ...args: unknown[]) {
      const to = args[0];
      if (this.classList.contains('dvn-scroller') && to && typeof to === 'object') {
        const { left, top, ...rest } = to as ScrollToOptions;
        return Reflect.apply(scrollTo, this, [{ ...rest, left: left == null ? left : left - 0.6, top: top == null ? top : top - 0.6 }]);
      }
      return Reflect.apply(scrollTo, this, args);
    } as typeof Element.prototype.scrollTo;
  });
  const { main, together } = await compareWide(page);
  const box = (await main.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await wheel(page, 0, 1500);
  await expect.poll(async () => Number(await main.getAttribute('data-first-row'))).toBeGreaterThan(10);
  await together('data-first-row').toMatch(/^[1-9]\d*$/);
  await wheel(page, 600, 0);
  await expect.poll(async () => (await main.getAttribute('data-first-column')) ?? '').toMatch(/^column_/);
  await together('data-first-column').toMatch(/^column_/);
});
