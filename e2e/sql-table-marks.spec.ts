import { expect, test } from '@playwright/test';
import { addFiles, fixture, node, openApp } from './helpers/app';

test('a SQL node’s editor marks the tables its query names, and pointing at one shows its node on the canvas', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /^SQL/ }).click();
  const query = page.getByLabel('SQL query');
  const marks = page.getByTestId('sql-query-marks').locator('[data-mark]');

  // As it is typed, before anything is applied: a table that is wired in, and one that isn't anywhere.
  await query.fill('SELECT o.order_id\nFROM input1 o\nJOIN customers c ON c.customer_id = o.customer_id');
  await expect(marks).toHaveText(['input1', 'customers']);
  await expect(marks.nth(0)).toHaveAttribute('data-found', 'true');
  await expect(marks.nth(1)).toHaveAttribute('data-found', 'false');
  await expect(marks.nth(1)).toHaveCSS('text-decoration-style', 'wavy');
  // The coloured copy sits exactly where the textarea's own text does.
  const [area, under] = await Promise.all([query.boundingBox(), page.getByTestId('sql-query-marks').boundingBox()]);
  expect(under).toEqual(area);

  // Pointing at the table's name marks the node it is; moving off the name lets go.
  const source = page.locator('.react-flow__node', { has: node(page, 'shop-orders.csv') });
  await expect(source).not.toHaveClass(/is-pointed/);
  const name = (await marks.nth(0).boundingBox())!;
  await page.mouse.move(name.x + name.width / 2, name.y + name.height / 2);
  await expect(source).toHaveClass(/is-pointed/);
  await expect(marks.nth(0)).toHaveClass(/is-pointed/);
  const missing = (await marks.nth(1).boundingBox())!;
  await page.mouse.move(missing.x + missing.width / 2, missing.y + missing.height / 2);
  await expect(source).not.toHaveClass(/is-pointed/);

  // A table the script creates is found too, and points at its own node once the script is applied.
  await query.fill('CREATE TABLE big AS SELECT * FROM input1 WHERE total > 5;\nSELECT count(*) AS n FROM big');
  await query.press('Control+Enter');
  await expect(node(page, 'big')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(marks).toHaveText(['big', 'input1', 'big']);
  const last = (await marks.nth(2).boundingBox())!;
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2);
  await expect(page.locator('.react-flow__node', { has: node(page, 'big') })).toHaveClass(/is-pointed/);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
});
