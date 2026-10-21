import { expect, test } from '@playwright/test';
import { addFiles, fixture, node, openApp, selectNode } from './helpers/app';

// Principle 5 (one screen, no modes): the canvas, the relationships view, the query designer and the Schema view are tabs over the
// canvas area, one click or key apart, while the inspector and results stay where they are.
test('the view switcher moves between the canvas, relationships, the query designer and the schema', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-customers.csv'), fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok');
  const views = page.getByTestId('view-switcher').getByRole('tab');
  await expect(views).toHaveText(['Canvas', 'Relationships', 'Designer', 'Schema']);
  await expect(views.nth(2)).toBeDisabled();

  await selectNode(page, 'shop-customers.csv');
  await selectNode(page, 'shop-orders.csv', ['Shift']);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Query/ }).click();
  await expect(page.getByTestId('query-designer')).toBeVisible();
  await expect(views.nth(2)).toHaveText('Designer: Query 1');
  await expect(views.nth(2)).toHaveAttribute('aria-selected', 'true');

  // Back to the canvas by its tab: the inspector still shows the Query node.
  await views.nth(0).click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.getByLabel('Node name')).toHaveValue('Query 1');

  // And by the keys: 2 the relationships, 3 the designer, 4 the schema, 1 the canvas.
  await page.keyboard.press('2');
  await expect(page.getByTestId('relationships')).toBeVisible();
  await expect(views.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('3');
  await expect(page.getByTestId('query-designer')).toBeVisible();
  await expect(page.getByTestId('inspector')).toBeVisible();
  await page.keyboard.press('4');
  await expect(views.nth(3)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('schema-view')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.getByTestId('canvas')).toBeVisible();
});
