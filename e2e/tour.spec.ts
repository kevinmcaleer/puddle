import { expect, test, type Page } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp } from './helpers/app';

const tour = (page: Page) => page.getByTestId('tour');
const offer = (page: Page) => page.getByTestId('tour-offer');

const help = async (page: Page, item: string | RegExp) => {
  await page.getByTestId('help-menu').click();
  await page.getByRole('menuitem', { name: item }).click();
};

/** Press Tab until the named button in the tour has focus, then Enter: the keyboard alone, no clicks. */
async function pressInTour(page: Page, name: string) {
  const target = tour(page).getByRole('button', { name, exact: true });
  for (let i = 0; i < 6 && !(await target.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
  await page.keyboard.press('Enter');
}

const progress = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('puddle.tour') ?? 'null') as { offered: boolean; stop: number; finished: boolean } | null);

test('first launch offers the tour beside the empty canvas, without getting in the way', async ({ page }) => {
  await openApp(page);
  await expect(offer(page)).toBeVisible();
  await expect(offer(page)).toContainText('New to Puddle?');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Work starts as usual with the offer showing; once there's a source, the empty canvas and the offer make way.
  await addFiles(page, [fixture('messy.csv')]);
  await expectRows(page, 5);
  await expect(offer(page)).toHaveCount(0);
});

test('don’t show again keeps the offer away after a reload', async ({ page }) => {
  await openApp(page);
  await offer(page).getByRole('button', { name: 'Don’t show again' }).click();
  await expect(offer(page)).toHaveCount(0);
  expect(await progress(page)).toMatchObject({ offered: true, finished: false });
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('heading', { name: 'Start with a source' })).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
});

test('the tour opens a sample and every stop is reached and dismissed with the keyboard alone', async ({ page }) => {
  await openApp(page);
  await offer(page).getByRole('button', { name: 'Take the tour' }).click();

  await expect(page.getByTestId('project-name')).toHaveText('Sample: contact list');
  await expect(node(page, 'contacts.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(tour(page)).toHaveAttribute('data-stop', 'sources');
  await expect(page.getByRole('dialog', { name: 'Sources' })).toBeVisible();
  await expect(tour(page)).toBeFocused();
  await expect(page.getByTestId('tour-announcer')).toHaveText('Tour, stop 1 of 7: Sources');
  // The highlight sits on the source node.
  const box = (await node(page, 'contacts.csv').boundingBox())!;
  const ring = (await page.getByTestId('tour-highlight').boundingBox())!;
  expect(Math.abs(ring.x - box.x)).toBeLessThan(2);
  expect(Math.abs(ring.width - box.width)).toBeLessThan(2);
  await expect(tour(page).getByRole('button', { name: 'Back' })).toBeDisabled();

  const stops = ['sources', 'canvas', 'results', 'quickfix', 'steps', 'rules', 'output'];
  for (const [i, id] of stops.entries()) {
    await expect(tour(page)).toHaveAttribute('data-stop', id);
    await expect(tour(page)).toBeFocused();
    if (i < stops.length - 1) await pressInTour(page, 'Next');
  }
  await expect(page.getByTestId('tour-announcer')).toHaveText('Tour, stop 7 of 7: The Output node');
  // The last stop points at Add node, and Back goes back a stop.
  const addNode = (await page.locator('[data-tour="add-node"]').boundingBox())!;
  expect(Math.abs((await page.getByTestId('tour-highlight').boundingBox())!.x - addNode.x)).toBeLessThan(2);
  await pressInTour(page, 'Back');
  await expect(tour(page)).toHaveAttribute('data-stop', 'rules');
  await pressInTour(page, 'Next');
  await expect(tour(page).getByRole('button', { name: 'Skip' })).toHaveCount(0);
  await pressInTour(page, 'Finish');
  await expect(tour(page)).toHaveCount(0);
  expect(await progress(page)).toMatchObject({ offered: true, finished: true });

  // Help starts it again, on the open project, and Escape ends it.
  await help(page, 'Take the tour');
  await expect(tour(page)).toHaveAttribute('data-stop', 'sources');
  await expect(page.getByTestId('project-name')).toHaveText('Sample: contact list');
  await page.keyboard.press('Escape');
  await expect(tour(page)).toHaveCount(0);

  // A reload doesn't offer it again.
  await page.reload();
  await expect(node(page, 'contacts.csv')).toBeVisible({ timeout: 45_000 });
  await expect(tour(page)).toHaveCount(0);
});

test('stops wait for the action that teaches more, follow the layout and pick up where they were left', async ({ page }) => {
  await openApp(page);
  await help(page, 'Take the tour');
  await expect(node(page, 'contacts.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expectRows(page, 53);
  await tour(page).getByRole('button', { name: 'Next' }).click();
  await tour(page).getByRole('button', { name: 'Next' }).click();
  await expect(tour(page)).toHaveAttribute('data-stop', 'results');
  await expect(page.getByTestId('tour-action')).toHaveText('Select a column header to carry on.');

  // Selecting a column moves the tour on to the quick fixes.
  const table = (await page.getByTestId('results-table').boundingBox())!;
  await page.mouse.click(table.x + 100, table.y + 20);
  await expect(tour(page)).toHaveAttribute('data-stop', 'quickfix');
  await expect(page.getByTestId('quick-fixes')).toHaveAttribute('data-columns', 'name');

  // Applying a fix moves it on to the steps in the inspector, which it points at.
  await page.getByRole('toolbar', { name: 'Quick fixes' }).getByRole('button', { name: 'Trim' }).click();
  await expect(tour(page)).toHaveAttribute('data-stop', 'steps');
  await expect(node(page, 'Transform 1')).toBeVisible();
  const steps = page.getByRole('region', { name: 'Applied steps' });
  await expect(steps).toBeVisible();
  const ring = page.getByTestId('tour-highlight');
  await expect.poll(async () => Math.round((await ring.boundingBox())!.y - (await steps.boundingBox())!.y)).toBe(0);

  // The popover follows a window resize.
  const before = (await tour(page).boundingBox())!;
  await page.setViewportSize({ width: 1100, height: 640 });
  await expect.poll(async () => (await tour(page).boundingBox())!.x).not.toBe(before.x);
  const after = (await tour(page).boundingBox())!;
  expect(after.x + after.width).toBeLessThanOrEqual(1100);
  expect(after.y + after.height).toBeLessThanOrEqual(640);

  // Skipped part way, Help offers to resume where it was.
  await tour(page).getByRole('button', { name: 'Skip' }).click();
  await expect(tour(page)).toHaveCount(0);
  expect(await progress(page)).toMatchObject({ stop: 4, finished: false });
  await page.getByTestId('help-menu').click();
  await expect(page.getByRole('menuitem', { name: /Resume the tour/ })).toContainText('Stop 5 of 7');
  await page.getByRole('menuitem', { name: /Resume the tour/ }).click();
  await expect(tour(page)).toHaveAttribute('data-stop', 'steps');
});
