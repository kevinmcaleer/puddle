import { expect, test, type Page } from '@playwright/test';
import { openApp, saved } from './helpers/app';

// A database connection: made from the driver grid, tested (no service runs here, so the test says what to start),
// saved in the project without its password, signed in for this tab, listed under Project › Databases and on the
// home screen, and forgotten from there.
const projectMenu = async (page: Page, item: string) => {
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: item }).click();
};

test('a PostgreSQL connection is saved without its password and signed in for the tab', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /From database/ }).click();
  const list = page.getByRole('dialog', { name: 'Add source from a database' });
  await expect(list).toContainText('No connections yet');
  await list.getByRole('button', { name: 'New connection' }).click();

  const grid = page.getByRole('dialog', { name: 'New connection' }).getByTestId('driver-grid');
  await expect(grid.getByRole('listitem')).toHaveCount(25);
  await grid.getByRole('listitem', { name: 'PostgreSQL', exact: true }).click();

  const form = page.getByRole('dialog', { name: 'New PostgreSQL connection' });
  await expect(form.getByLabel('Port')).toHaveValue('5432');
  await expect(form.getByRole('button', { name: 'Save connection' })).toBeDisabled();
  await form.getByLabel('Host').fill('db.local');
  await form.getByLabel('Database').fill('shop');
  await form.getByLabel('User name').fill('kev');
  await form.getByLabel('Password').fill('hunter2');
  await expect(form.getByLabel('Where it runs')).toHaveValue('local');
  await form.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(form.getByTestId('conn-test')).toHaveAttribute('data-ok', 'false');
  await expect(form.getByTestId('conn-test')).toContainText('npx puddle-connect');
  await form.getByRole('button', { name: 'Save connection' }).click();

  const row = list.getByTestId('connection-PostgreSQL');
  await expect(row).toContainText('PostgreSQL · kev@db.local:5432/shop · on this computer · signed in');
  await expect(row).not.toContainText('not signed in');
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);

  // The project holds the connection and no password; the tab keeps the password through a reload.
  await expect.poll(async () => JSON.stringify(await saved(page))).toContain('db.local');
  expect(JSON.stringify(await saved(page))).not.toContain('hunter2');
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await projectMenu(page, 'Databases');
  const manage = page.getByRole('dialog', { name: 'Databases' });
  await expect(manage.getByTestId('connection-PostgreSQL')).not.toContainText('not signed in');
  await expect(manage.getByTestId('connection-PostgreSQL')).toContainText('signed in');
  await page.keyboard.press('Escape');

  // The home screen lists it across projects, and forgets every secret in one click.
  await projectMenu(page, 'All projects');
  const home = page.getByTestId('home-connections');
  await expect(home.getByTestId('home-connection-PostgreSQL')).not.toContainText('not signed in');
  await home.getByRole('button', { name: 'Forget all secrets' }).click();
  await expect(home.getByTestId('home-connection-PostgreSQL')).toContainText('not signed in');
});
