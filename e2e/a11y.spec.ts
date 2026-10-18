import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './helpers/axe';
import { addFiles, addStep, addStepNode, expectRows, fixture, node, openApp } from './helpers/app';

const projectMenu = async (page: Page, item: string) => {
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: item }).click();
};

/** customers.csv wired into a Transform with one step and an Output, the Transform viewed and selected. */
async function smallFlow(page: Page) {
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, 'customers.csv').click();
  await addStepNode(page, 'Trim whitespace');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Output/ }).click();
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, 'Transform 1').click();
  await expectRows(page, 4);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test('the home screen, the empty canvas and the start dialogs', async ({ page }) => {
      await openApp(page);
      await expectAccessible(page, 'the empty canvas');

      await page.getByRole('button', { name: 'Try a sample' }).click();
      await expect(page.getByRole('dialog', { name: 'Try a sample' })).toBeVisible();
      await expectAccessible(page, 'the samples dialog');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByRole('menuitem', { name: /From URL/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page, 'the URL dialog');
      await page.keyboard.press('Escape');

      await page.keyboard.press('Shift+?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
      await expectAccessible(page, 'the shortcuts dialog');
      await page.keyboard.press('Escape');

      await projectMenu(page, 'Sync to GitHub Gist');
      await expect(page.getByRole('dialog', { name: 'Sync to GitHub Gist' })).toBeVisible();
      await expectAccessible(page, 'the sync dialog');
      await page.keyboard.press('Escape');

      await projectMenu(page, 'Sync to Google Drive');
      await expect(page.getByRole('dialog', { name: 'Sync to Google Drive' })).toBeVisible();
      await expectAccessible(page, 'the Google Drive dialog');
      await page.keyboard.press('Escape');

      await projectMenu(page, 'Rename');
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page, 'the rename dialog');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expectAccessible(page, 'an open menu');
      await page.keyboard.press('Escape');

      await page.getByRole('tab', { name: 'Notes' }).click();
      await expect(page.getByTestId('notes-panel')).toBeVisible();
      await expectAccessible(page, 'the notes tab');
      await page.getByRole('tab', { name: 'Project' }).click();
      await expect(page.getByTestId('project-settings')).toBeVisible();

      // The open menu hangs over the inspector's tabs, which axe reads as obscured targets, so the dock is hidden
      // while the menu itself is checked.
      await page.keyboard.press('i');
      await expect(page.getByTestId('inspector')).not.toBeAttached();
      await page.getByTestId('help-menu').click();
      await expect(page.getByRole('group', { name: 'Theme' })).toBeVisible();
      await expectAccessible(page, 'the Help menu');
      await page.keyboard.press('Escape');
      await page.keyboard.press('i');
      await expect(page.getByTestId('inspector')).toBeVisible();

      await projectMenu(page, 'All projects');
      await expect(page.getByTestId('home')).toBeVisible();
      await expectAccessible(page, 'the home screen');
    });

    test('the canvas, results, inspector and rules', async ({ page }) => {
      await openApp(page);
      await smallFlow(page);
      await page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option').first().click();
      await expect(page.getByTestId('step-settings')).toBeVisible();
      await expectAccessible(page, 'the canvas, results and the Transform inspector with a step’s settings');
      // An unfinished pivot also breaks the Transform, so a broken node and the Output waiting on it are checked too.
      await addStep(page, 'Pivot or group by');
      await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'blocked');
      await expectAccessible(page, 'the pivot editor, a broken node and a node waiting on it');

      await node(page, 'customers.csv').click();
      await page.getByRole('button', { name: 'Add rule' }).click();
      await page.getByRole('menuitem', { name: 'No leading or trailing spaces', exact: true }).click();
      await page.getByTestId('rule-settings').getByRole('button', { name: 'name', exact: true }).click();
      await expect(page.getByTestId('rules').locator('.ui-rule').first()).toHaveAttribute('data-status', 'fail', { timeout: 20_000 });
      await expectAccessible(page, 'the rules');

      await node(page, 'Output 1').click();
      await expectAccessible(page, 'the Output inspector, viewing a waiting node');
      await page.getByRole('button', { name: 'Export quality report' }).click();
      await expect(page.getByTestId('report-dialog')).toBeVisible();
      await expectAccessible(page, 'the report dialog');
    });

    test('the query designer', async ({ page }) => {
      await openApp(page);
      await addFiles(page, [fixture('shop-customers.csv'), fixture('shop-orders.csv')]);
      await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
      await node(page, 'shop-customers.csv').click();
      await node(page, 'shop-orders.csv').click({ modifiers: ['Shift'] });
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByRole('menuitem', { name: /Query/ }).click();
      await expect(page.getByTestId('query-designer')).toBeVisible();

      await expectAccessible(page, 'the query designer');

      await page.getByTestId('query-field-1-customer_id').getByRole('button').press('Enter');
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page, 'a field’s actions in the query designer');
      await page.getByRole('dialog').getByRole('button', { name: 'Add join' }).click();
      await page.getByRole('button', { name: 'Back to canvas' }).click();
      await expect(page.getByTestId('canvas')).toBeVisible();

      await node(page, 'shop-customers.csv').click();
      await node(page, 'shop-orders.csv').click({ modifiers: ['Shift'] });
      await page.getByRole('button', { name: 'Join these two' }).click();
      await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
      await expectAccessible(page, 'the Join inspector');
    });

    test('the Schema view', async ({ page }) => {
      await openApp(page);
      await projectMenu(page, 'Schema');
      await page.getByRole('button', { name: 'Insert example' }).click();
      await expect(page.getByTestId('schema-table-orders')).toBeVisible();
      await page.getByRole('combobox', { name: 'DBML' }).press('End');
      await page.keyboard.type('\nTable broken {\n  oops');
      await expect(page.getByTestId('schema-errors')).toBeVisible();
      await expectAccessible(page, 'the Schema view, with a mistake listed');
    });
  });
}
