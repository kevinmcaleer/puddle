import { expect, test } from '@playwright/test';

test('the empty shell renders with every docked region', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.ui-wordmark')).toHaveText('Puddle');
  await expect(page.getByRole('button', { name: 'Add source' }).first()).toBeVisible();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.getByTestId('inspector')).toBeVisible();
  await expect(page.getByTestId('results-panel')).toBeVisible();
  await expect(page.getByText('Nothing leaves your browser. Projects save the steps, not the data.', { exact: false })).toBeVisible();
});

test('the inspector is docked at the token width', async ({ page }) => {
  await page.goto('/');
  const box = await page.getByTestId('inspector').boundingBox();
  expect(box?.width).toBe(320);
});

test('theme follows the OS and can be overridden', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const html = page.locator('html');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(html).not.toHaveAttribute('data-theme');
  const darkSystem = await bg();

  const toggle = page.getByTestId('theme-toggle');
  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await bg()).not.toBe(darkSystem);

  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await bg()).toBe(darkSystem);

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await toggle.click();
  await expect(html).not.toHaveAttribute('data-theme');
});

test('the results panel collapses and expands', async ({ page }) => {
  await page.goto('/');
  const panel = page.getByTestId('results-panel');
  await page.getByRole('button', { name: 'Hide results' }).click();
  await expect(panel).toHaveAttribute('data-collapsed', 'true');
  await page.getByRole('button', { name: 'Show results' }).click();
  await expect(panel).toHaveAttribute('data-collapsed', 'false');
});
