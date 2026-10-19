import { expect, test } from '@playwright/test';

test('the empty shell renders with every docked region', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.ui-wordmark')).toHaveText('Puddle');
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
  // Seven controls and no more: the wordmark (the way to every project), the project menu, Add, undo, redo, Help and
  // the inspector toggle.
  await expect(page.locator('.ui-toolbar').getByRole('button')).toHaveCount(7);
  await expect(page.locator('.ui-toolbar .ui-wordmark')).toHaveCount(1);
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

test.describe('with a dark OS theme', () => {
  // Set for the whole context, as the OS would.
  test.use({ colorScheme: 'dark' });

  test('theme follows the OS and can be overridden', async ({ page, browserName }) => {
    await page.goto('/');
    const html = page.locator('html');
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const osDark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
    // Chromium and WebKit take the emulated dark scheme. Playwright's Firefox reports a light one regardless, and
    // there the page must follow that instead: either way the system theme is what the browser says.
    if (browserName !== 'firefox') expect(osDark).toBe(true);
    await expect(html).not.toHaveAttribute('data-theme');
    const system = await bg();

    // The theme lives with the other display settings, in the inspector's Project tab, as a choice of three.
    const pickTheme = async (name: string) => {
      await page.getByRole('tab', { name: 'Project' }).click();
      await page.getByTestId('display-settings').getByLabel('Theme').selectOption({ label: name });
    };
    await pickTheme('Light');
    await expect(html).toHaveAttribute('data-theme', 'light');
    const light = await bg();
    expect(light === system).toBe(!osDark);

    await pickTheme('Dark');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    const dark = await bg();
    expect(dark).not.toBe(light);
    expect(dark === system).toBe(osDark);

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('tab', { name: 'Project' }).click();
    await expect(page.getByTestId('display-settings').getByLabel('Theme')).toHaveValue('dark');
    await pickTheme('Match the system');
    await expect(html).not.toHaveAttribute('data-theme');
    expect(await bg()).toBe(system);
  });
});

test('the results panel collapses and expands', async ({ page }) => {
  await page.goto('/');
  const panel = page.getByTestId('results-panel');
  await page.getByRole('button', { name: 'Hide results' }).click();
  await expect(panel).toHaveAttribute('data-collapsed', 'true');
  await page.getByRole('button', { name: 'Show results' }).click();
  await expect(panel).toHaveAttribute('data-collapsed', 'false');
});
