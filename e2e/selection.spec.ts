import { expect, test, type Page } from '@playwright/test';
import { addFiles, fixture, node, openApp } from './helpers/app';

const selected = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? '');
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test('the page selects like an app: never the whole page, but fields and answers still copy', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });

  // Ctrl+A from the canvas, or a drag down the inspector's text, selects no text.
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press(`${mod}+a`);
  expect(await selected(page)).toBe('');
  const from = (await page.getByTestId('inspector').boundingBox())!;
  await page.mouse.move(from.x + 8, from.y + 8);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width - 8, from.y + from.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await selected(page)).toBe('');

  // In a text field, Ctrl+A still selects what was typed.
  await page.getByTestId('console-toggle').click();
  const query = page.getByLabel('Console query');
  await query.fill('SELECT customer_id FROM input ORDER BY 1 LIMIT 2');
  await query.press(`${mod}+a`);
  expect(await query.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('SELECT customer_id FROM input ORDER BY 1 LIMIT 2');

  // A console answer can be selected by dragging across it, and Ctrl+A there selects just the answer.
  await query.press('Control+Enter');
  const answer = page.getByTestId('console-answer');
  const first = answer.locator('tbody td').first();
  await expect(first).toBeVisible();
  const a = (await first.boundingBox())!;
  const b = (await answer.locator('tbody td').last().boundingBox())!;
  await page.mouse.move(a.x + 1, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await selected(page)).not.toBe('');
  await page.keyboard.press(`${mod}+a`);
  expect((await selected(page)).trim()).toBe((await answer.innerText()).trim());
});
