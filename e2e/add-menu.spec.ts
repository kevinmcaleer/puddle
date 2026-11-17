import { expect, test } from '@playwright/test';
import { addFiles, fixture, node, openApp, selectNode } from './helpers/app';

// #293: with nothing selected the Add menu listed Join, Append, Lookup, Query, SQL and every step greyed out, and with
// a node selected it was one long list of steps.
test('the Add menu has no disabled entry with nothing selected, and folds the steps into groups once a node is', async ({ page }) => {
  await openApp(page);
  const add = page.getByRole('button', { name: 'Add', exact: true });
  const menu = page.getByRole('menu', { name: 'Add' });

  // Nothing selected: sources and the nodes that need no input, none of them disabled, and a line on the rest.
  await add.click();
  await expect(menu.getByRole('menuitem', { name: /^Choose files/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Table from SQL/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { disabled: true })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /^Join/ })).toHaveCount(0);
  await expect(page.getByTestId('menu-note')).toHaveText('Select a node to add a step or another node after it.');
  await page.keyboard.press('Escape');

  await addFiles(page, [fixture('customers.csv')]);
  await selectNode(page, 'customers.csv');
  await add.click();
  await expect(page.getByTestId('menu-note')).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /^Join/ })).toBeEnabled();
  // The steps are behind their group headings, each saying how many it holds.
  const clean = menu.getByRole('menuitem', { name: /^Clean steps/ });
  await expect(clean).toHaveAttribute('aria-expanded', 'false');
  await expect(menu.getByRole('menuitem', { name: /^Trim whitespace/ })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /^Dates steps/ })).toHaveAttribute('aria-expanded', 'false');
  expect(await menu.getByRole('menuitem').count()).toBeLessThan(30);

  // A heading opens its group, and a step in it is added after the selected node.
  await clean.click();
  await expect(clean).toHaveAttribute('aria-expanded', 'true');
  await menu.getByRole('menuitem', { name: /^Trim whitespace/ }).click();
  await expect(node(page, 'Transform 1')).toBeVisible();
  await expect(page.getByTestId('wire-customers.csv->Transform 1')).toBeAttached();

  // The search finds a step in a folded group.
  await add.click();
  await page.getByLabel('Search steps and nodes').fill('remove blank');
  await expect(menu.getByRole('menuitem', { name: /^Remove blank rows/ })).toBeVisible();
});
