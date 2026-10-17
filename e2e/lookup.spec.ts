import { expect, test, type Page } from '@playwright/test';
import { addFiles, cell, expectRows, fixture, node, openApp } from './helpers/app';

/**
 * Orders and customers on the canvas, with customer names looked up onto orders: select orders, then
 * Shift+click customers, then Add node › Lookup (or the selection bar's button).
 */
async function lookUpShop(page: Page, via: 'menu' | 'selection bar' = 'menu') {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv'), fixture('shop-customers.csv')]);
  await expect(node(page, 'shop-customers.csv')).toHaveAttribute('data-status', 'ok');
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok');
  await node(page, 'shop-orders.csv').click();
  await node(page, 'shop-customers.csv').click({ modifiers: ['Shift'] });
  if (via === 'menu') {
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: /Lookup/ }).click();
  } else await page.getByTestId('group-bar').getByRole('button', { name: 'Look up from the second' }).click();
  await expect(node(page, 'Lookup 1')).toHaveAttribute('data-status', 'ok');
}

const columns = (page: Page) => page.getByTestId('inspector-columns').locator('.ui-col');

test('looking up customer names onto orders keeps every order once, and explains duplicate and missing keys', async ({ page }) => {
  await lookUpShop(page);
  const lookup = node(page, 'Lookup 1');
  await expect(page.getByTestId('wire-shop-orders.csv->Lookup 1')).toHaveAttribute('data-port', 'main');
  await expect(page.getByTestId('wire-shop-customers.csv->Lookup 1')).toHaveAttribute('data-port', 'lookup');
  await expect(lookup).toContainText('Lookup · 1 column');

  // It starts matching on the shared key and brings across the column orders don't have.
  const inspector = page.getByTestId('inspector-lookup');
  await expect(inspector.getByTestId('lookup-inputs')).toContainText('Mainshop-orders.csvLookupshop-customers.csv');
  await expect(inspector.getByLabel('Main column 1')).toHaveValue('customer_id');
  await expect(inspector.getByLabel('Lookup column 1')).toHaveValue('customer_id');
  await expect(inspector.getByTestId('lookup-columns')).toContainText('name');
  await expect(columns(page)).toHaveText(['order_id', 'customer_id', 'total', 'status', 'name']);

  // Customer 5 is in the lookup twice and customer 4 not at all: still 5 rows, and both are explained.
  await lookup.click();
  await expectRows(page, 5);
  await expect(inspector.getByTestId('lookup-match')).toHaveText('4 of 5 rows matched (80%)');
  await expect(inspector.getByTestId('lookup-duplicates')).toContainText('1 key matches more than one lookup row');
  await expect(inspector.getByTestId('lookup-duplicates')).toContainText('For example 5. 1 main row took the first match in file order, so the lookup still has 5 rows.');
  await expect(inspector.getByTestId('lookup-missing')).toContainText('1 key has no match');
  await expect(inspector.getByTestId('lookup-missing')).toContainText('For example 4. The new columns of 1 row are left empty.');
  await expect(cell(page, 4, 4)).toHaveText('Barbara');

  // Bring status across too: it clashes, so it gets the suffix.
  await inspector.getByLabel('Add a column to bring across').selectOption('status');
  await expect(columns(page)).toHaveText(['order_id', 'customer_id', 'total', 'status', 'name', 'status_lookup']);
  await expect(inspector.getByLabel('Suffix for clashing columns')).toHaveValue('_lookup');
  await expect(lookup).toContainText('Lookup · 2 columns');
  await inspector.getByRole('button', { name: 'Remove status' }).click();
  await expect(columns(page)).toHaveText(['order_id', 'customer_id', 'total', 'status', 'name']);

  // A default for unmatched keys fills order 103's name.
  await inspector.getByLabel('Fill unmatched rows with a default').click();
  await inspector.getByLabel('Default value').fill('Unknown');
  await inspector.getByLabel('Default value').press('Enter');
  await expect(inspector.getByTestId('lookup-missing')).toContainText('are filled with “Unknown”');
  await expect(cell(page, 4, 3)).toHaveText('Unknown');
  await expectRows(page, 5);

  // Swapping the inputs asks for the columns again; undo puts everything back.
  await inspector.getByRole('button', { name: 'Swap inputs' }).click();
  await expect(page.getByTestId('wire-shop-customers.csv->Lookup 1')).toHaveAttribute('data-port', 'main');
  await expect(lookup).toHaveAttribute('data-status', 'error');
  await expect(inspector).toContainText('Pick at least one column to bring across.');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('wire-shop-customers.csv->Lookup 1')).toHaveAttribute('data-port', 'lookup');
  await expect(lookup).toHaveAttribute('data-status', 'ok');
});

test('a key type mismatch and a default that doesn’t fit are explained before anything runs', async ({ page }) => {
  await lookUpShop(page, 'selection bar');
  const inspector = page.getByTestId('inspector-lookup');
  // Match orders' numeric customer_id against customers' text name.
  await inspector.getByLabel('Lookup column 1').selectOption('name');
  const message = 'customer_id in the main input is a number and name in the lookup is text; change one with Change type.';
  await expect(node(page, 'Lookup 1')).toHaveAttribute('data-status', 'error');
  await expect(node(page, 'Lookup 1')).toContainText(message);
  await expect(inspector.getByTestId('lookup-keys')).toContainText(message);
  await inspector.getByLabel('Lookup column 1').selectOption('customer_id');
  await expect(node(page, 'Lookup 1')).toHaveAttribute('data-status', 'ok');

  // customer_id brought across is a number, so "none" can't fill it.
  await inspector.getByLabel('Add a column to bring across').selectOption('customer_id');
  await inspector.getByLabel('Fill unmatched rows with a default').click();
  await inspector.getByLabel('Default value').fill('none');
  await inspector.getByLabel('Default value').press('Enter');
  await expect(inspector).toContainText('customer_id is a number, so it can’t be filled with “none”.');
  await expect(node(page, 'Lookup 1')).toHaveAttribute('data-status', 'error');
  await inspector.getByLabel('Default value').fill('0');
  await inspector.getByLabel('Default value').press('Enter');
  await expect(node(page, 'Lookup 1')).toHaveAttribute('data-status', 'ok');
});

test('unwiring the lookup input marks it unwired, and a wire into a taken input is refused', async ({ page }) => {
  await lookUpShop(page);
  // Dragging customers onto the taken main input is refused with the reason.
  await node(page, 'shop-customers.csv').locator('.react-flow__handle.source').hover();
  await page.mouse.down();
  const box = (await node(page, 'Lookup 1').locator('.react-flow__handle.target[data-handleid="main"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('canvas-notice')).toContainText('The main input of Lookup 1 already has a wire');

  await page.getByTestId('canvas').click({ position: { x: 20, y: 20 } });
  await page.getByTestId('wire-shop-customers.csv->Lookup 1').click({ force: true });
  await page.keyboard.press('Delete');
  await expect(node(page, 'Lookup 1')).toHaveAttribute('data-status', 'unwired');
  await page.keyboard.press('Control+z');
  await expect(node(page, 'Lookup 1')).toHaveAttribute('data-status', 'ok');
});
