import { expect, test } from '@playwright/test';
import { addFiles, addStepWithT, expectRows, fixture, node, openApp, saved, selectNode } from './helpers/app';

type Described = { nodes: { name: string; description?: string }[]; groups: { name: string; description?: string }[] };

test('nodes and groups are described in the user’s words, on the canvas and in the inspector, and keep it through a reload', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('messy.csv')]);
  await expectRows(page, 5);
  await addStepWithT(page, 'Trim whitespace');
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');

  // From the node's right-click menu, written in place under its heading.
  await node(page, 'Transform 1').click({ button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Add description' }).click();
  await page.getByLabel('Description of Transform 1').fill('names arrive padded');
  await page.keyboard.press('Enter');
  await expect(node(page, 'Transform 1').getByTestId('description')).toHaveText('names arrive padded');

  // The inspector shows the same words and changes them too.
  await selectNode(page, 'Transform 1');
  const field = page.getByTestId('inspector').getByLabel('Description', { exact: true });
  await expect(field).toHaveValue('names arrive padded');
  await field.fill('combine into a single list');
  await field.press('Enter');
  await expect(node(page, 'Transform 1').getByTestId('description')).toHaveText('combine into a single list');

  // A group is described from its menu too.
  await selectNode(page, 'messy.csv');
  await selectNode(page, 'Transform 1', ['Shift']);
  await page.keyboard.press('g');
  const card = page.getByTestId('group-Group 1');
  await card.click({ button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Add group description' }).click();
  await page.getByLabel('Description of Group 1').fill('touchless rate per month');
  await page.keyboard.press('Enter');
  await expect(card.getByTestId('description')).toHaveText('touchless rate per month');
  // Escape leaves it as it was.
  await card.click({ button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Edit group description' }).click();
  await expect(page.getByLabel('Description of Group 1')).toBeFocused();
  await page.keyboard.type('something else');
  await page.keyboard.press('Escape');
  await expect(card.getByTestId('description')).toHaveText('touchless rate per month');

  // Open, its frame carries the description above its nodes, each with its own.
  await card.getByRole('button', { name: 'Open Group 1' }).click();
  await expect(page.getByTestId('frame-Group 1').getByTestId('description')).toHaveText('touchless rate per month');
  await expect(node(page, 'Transform 1').getByTestId('description')).toHaveText('combine into a single list');

  await expect
    .poll(async () => (await saved(page)) as unknown as Described)
    .toMatchObject({ nodes: expect.arrayContaining([expect.objectContaining({ name: 'Transform 1', description: 'combine into a single list' })]), groups: [{ name: 'Group 1', description: 'touchless rate per month' }] });
  await page.reload();
  await expect(page.getByTestId('frame-Group 1').getByTestId('description')).toHaveText('touchless rate per month');
  await expect(node(page, 'Transform 1').getByTestId('description')).toHaveText('combine into a single list');
});
