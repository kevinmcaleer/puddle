import { expect, test } from '@playwright/test';
import { addFiles, fixture, node, openApp } from './helpers/app';

/** The open project's settings and sources, as the app holds them. */
const held = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const { store } = globalThis.__puddle as unknown as { store: { getState(): { history: { present: { settings: { schedule?: string }; sources: Array<{ file?: { path?: string } }> } } } } };
    const p = store.getState().history.present;
    return { schedule: p.settings.schedule, path: p.sources[0]?.file?.path };
  });

test('a project takes a schedule and a source takes its path on the runner, both saved with the project', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });

  // The runner path sits on the source, under its read options.
  await node(page, 'customers.csv').click();
  await page.getByLabel('Path to this file').fill('sources/customers.csv');
  await page.getByLabel('Path to this file').press('Enter');
  await expect.poll(() => held(page)).toMatchObject({ path: 'sources/customers.csv' });

  // The schedule is a project setting, in the Project tab.
  await page.getByRole('tab', { name: 'Project' }).click();
  await page.getByLabel('Run on a schedule').fill('0 3 * * *');
  await page.getByLabel('Run on a schedule').press('Enter');
  await expect.poll(() => held(page)).toEqual({ schedule: '0 3 * * *', path: 'sources/customers.csv' });

  // Both are one undo step each, and clearing them takes them out of the project.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => held(page)).toEqual({ schedule: undefined, path: 'sources/customers.csv' });
  await page.getByRole('button', { name: 'Redo' }).click();
  await page.getByLabel('Run on a schedule').fill('');
  await page.getByLabel('Run on a schedule').press('Enter');
  await expect.poll(() => held(page)).toEqual({ schedule: undefined, path: 'sources/customers.csv' });
});
