import { expect, test } from '@playwright/test';

test('the app switcher reads the shared list and goes to another Power Tools app', async ({ page }) => {
  // The landing page's list, served cross-origin as the real one is, with an app the built-in copy does not know.
  await page.route('https://kevspowertools.com/apps.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' },
      body: JSON.stringify({
        apps: [
          { id: 'puddle', name: 'Puddle', url: 'https://puddle.kevspowertools.com/', status: 'live' },
          { id: 'mermaid-factory', name: 'Mermaid Factory', url: 'https://mermaid.kevspowertools.com/', status: 'live' },
          { id: 'new-tool', name: 'New tool', url: 'https://new.kevspowertools.com/', status: 'live' },
        ],
      }),
    }),
  );
  await page.route('https://mermaid.kevspowertools.com/', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Mermaid Factory</title>' }));

  await page.goto('/');
  await page.getByRole('button', { name: 'Switch app' }).click();
  const menu = page.getByRole('menu', { name: 'Switch app' });
  await expect(menu.getByRole('menuitemradio', { name: /Puddle/ })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitemradio', { name: /New tool/ })).toBeVisible();
  await menu.getByRole('menuitemradio', { name: /Mermaid Factory/ }).click();
  await expect(page).toHaveURL('https://mermaid.kevspowertools.com/');
});
