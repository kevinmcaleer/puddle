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
  await expect(page.getByRole('heading', { name: 'Drop a messy file here' })).toBeVisible();
  await expect(offer(page)).toHaveCount(0);
});

test('the tour opens a sample and every stop is reached and dismissed with the keyboard alone', async ({ page }) => {
  await openApp(page);
  await offer(page).getByRole('button', { name: 'Take the tour' }).click();

  await expect(page.getByTestId('project-name')).toHaveText('Sample: contact list');
  await expect(node(page, 'contacts.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(tour(page)).toHaveAttribute('data-stop', 'found');
  await expect(page.getByRole('dialog', { name: 'What Puddle found' })).toBeVisible();
  await expect(tour(page)).toBeFocused();
  await expect(page.getByTestId('tour-announcer')).toHaveText('Tour, stop 1 of 7: What Puddle found');
  // The highlight sits on the headline that says what was found.
  const headline = page.getByTestId('findings-headline');
  await expect(headline).toBeVisible({ timeout: 20_000 });
  const ring = page.getByTestId('tour-highlight');
  await expect.poll(async () => Math.abs((await ring.boundingBox())!.x - (await headline.boundingBox())!.x)).toBeLessThan(2);
  await expect.poll(async () => Math.abs((await ring.boundingBox())!.width - (await headline.boundingBox())!.width)).toBeLessThan(2);
  await expect(tour(page).getByRole('button', { name: 'Back' })).toBeDisabled();

  // The stops follow a first visit: what was found, Fix all, the receipt, Export, and then how it works.
  const stops = ['found', 'fixall', 'receipt', 'export', 'canvas', 'steps', 'rules'];
  for (const [i, id] of stops.entries()) {
    await expect(tour(page)).toHaveAttribute('data-stop', id);
    await expect(tour(page)).toBeFocused();
    if (i < stops.length - 1) await pressInTour(page, 'Next');
  }
  await expect(page.getByTestId('tour-announcer')).toHaveText('Tour, stop 7 of 7: Rules');
  // Back goes back a stop.
  await pressInTour(page, 'Back');
  await expect(tour(page)).toHaveAttribute('data-stop', 'steps');
  await pressInTour(page, 'Next');
  await expect(tour(page).getByRole('button', { name: 'Skip' })).toHaveCount(0);
  await pressInTour(page, 'Finish');
  await expect(tour(page)).toHaveCount(0);
  expect(await progress(page)).toMatchObject({ offered: true, finished: true });

  // Help starts it again, on the open project, and Escape ends it.
  await help(page, 'Take the tour');
  await expect(tour(page)).toHaveAttribute('data-stop', 'found');
  await expect(page.getByTestId('project-name')).toHaveText('Sample: contact list');
  await page.keyboard.press('Escape');
  await expect(tour(page)).toHaveCount(0);

  // A reload doesn't offer it again.
  await page.reload();
  await expect(node(page, 'contacts.csv')).toBeVisible({ timeout: 45_000 });
  await expect(tour(page)).toHaveCount(0);
});

test('the Fix all stop waits for the fix, the next stops point at the receipt and its foot, and a skipped tour picks up where it was left', async ({ page }) => {
  await openApp(page);
  await help(page, 'Take the tour');
  await expect(node(page, 'contacts.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expectRows(page, 53);
  await tour(page).getByRole('button', { name: 'Next' }).click();
  await expect(tour(page)).toHaveAttribute('data-stop', 'fixall');
  await expect(page.getByTestId('tour-action')).toHaveText('Choose Fix all to carry on.');
  // The highlight sits on the Fix all button.
  const fixAll = page.getByTestId('findings-headline').getByRole('button', { name: /^Fix \d+ (of \d+ )?issues?$/ });
  const ring = page.getByTestId('tour-highlight');
  await expect.poll(async () => Math.round((await ring.boundingBox())!.x - (await fixAll.boundingBox())!.x)).toBe(0);

  // Fixing moves the tour on to the receipt, which it points at.
  await fixAll.click();
  await expect(tour(page)).toHaveAttribute('data-stop', 'receipt');
  const receipt = page.getByTestId('fix-receipt');
  await expect(receipt).toBeVisible();
  await expect.poll(async () => Math.round((await ring.boundingBox())!.y - (await receipt.boundingBox())!.y)).toBe(0);

  // The next stop points at the receipt's foot, where Export is.
  await tour(page).getByRole('button', { name: 'Next' }).click();
  await expect(tour(page)).toHaveAttribute('data-stop', 'export');
  await expect.poll(async () => Math.round((await ring.boundingBox())!.y - (await receipt.getByTestId('receipt-foot').boundingBox())!.y)).toBe(0);

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
  expect(await progress(page)).toMatchObject({ stop: 3, finished: false });
  await page.getByTestId('help-menu').click();
  await expect(page.getByRole('menuitem', { name: /Resume the tour/ })).toContainText('Stop 4 of 7');
  await page.getByRole('menuitem', { name: /Resume the tour/ }).click();
  await expect(tour(page)).toHaveAttribute('data-stop', 'export');
});
