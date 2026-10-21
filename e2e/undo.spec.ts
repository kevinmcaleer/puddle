import { expect, test, type Page } from '@playwright/test';
import { addFiles, fixture, node, openApp, saved, selectNode } from './helpers/app';

const projectMenu = async (page: Page, item: string) => {
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: item }).click();
};

test('undo in the editor: files added together go in one step, and Ctrl+Z works from the select just changed', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv'), fixture('orders.tsv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  await expect(node(page, 'orders.tsv')).toHaveAttribute('data-status', 'ok');

  await selectNode(page, 'customers.csv');
  const delimiter = page.getByLabel('Delimiter');
  const before = await delimiter.inputValue();
  await delimiter.focus();
  await delimiter.selectOption({ label: 'Semicolon' });
  await expect(delimiter).not.toHaveValue(before);
  // Focus stays on the select, which has no typing of its own to undo.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(delimiter).toHaveValue(before);

  // The next undo takes both files away at once, and redo brings both back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(node(page, 'customers.csv')).toHaveCount(0);
  await expect(node(page, 'orders.tsv')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  await expect(node(page, 'orders.tsv')).toHaveAttribute('data-status', 'ok');
});

test('undo on the projects screen brings a deleted project back', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect.poll(async () => (await saved(page))?.nodes.length).toBe(1);
  await projectMenu(page, 'All projects');
  const home = page.getByTestId('home');
  const project = home.getByRole('list', { name: 'Projects' }).getByRole('listitem');
  await expect(project).toHaveCount(1);

  await project.getByRole('button', { name: /^More for / }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete project?' }).getByRole('button', { name: 'Delete project' }).click();
  await expect(home.getByText('No projects yet')).toBeVisible();

  await expect(home.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', /^Undo delete /);
  await home.getByRole('button', { name: 'Undo' }).click();
  await expect(project).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(home.getByText('No projects yet')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(project).toHaveCount(1);

  // It opens with its steps, as it was.
  await project.getByRole('button').first().click();
  await expect(node(page, 'customers.csv')).toBeVisible();
});
