import { expect, test, type Download, type Page } from '@playwright/test';
import { addStepWithT, fixture, node, openApp } from './helpers/app';

const focusedNode = (page: Page) => page.locator('.react-flow__node:focus');
const textOf = async (file: Download) => Buffer.concat(await (await file.createReadStream()).toArray()).toString('utf8');

/** Press A and choose a file in the browser's own file dialog (keyboard-operable; Playwright stands in for it). */
async function addWithA(page: Page, name: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('a');
  await (await chooser).setFiles([fixture(name)]);
  await expect(node(page, name)).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
}

test('a pipeline is built, run and exported with the keyboard alone', async ({ page }) => {
  await openApp(page);
  await addWithA(page, 'customers.csv');
  // The new source is selected and has the keyboard, and says what it is.
  await expect(focusedNode(page)).toHaveAttribute('aria-label', /^customers\.csv, Source, CSV, 4 rows, 4 columns/);

  // T opens the Add menu's search; Enter adds the step as a Transform after it, selected and in the inspector.
  await addStepWithT(page, 'Trim whitespace');
  await expect(node(page, 'Transform 1')).toHaveAttribute('aria-label', /^Transform 1, Transform, 1 step/);
  await page.keyboard.press('f');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('inspector')).toBeFocused();

  // / searches the inspector's Add step menu; Enter adds the match to this node.
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search steps')).toBeFocused();
  await page.keyboard.type('case');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('inspector').locator('.ui-step')).toHaveCount(2);
  // Focus went back to the menu's button.
  await expect(page.getByRole('button', { name: 'Add step' })).toBeFocused();

  // F goes back to the canvas; O adds an Output after the Transform, V views it, E exports it.
  await page.keyboard.press('f');
  await expect(page.getByRole('main', { name: 'Canvas' })).toBeFocused();
  await page.keyboard.press('o');
  await expect(focusedNode(page)).toHaveAttribute('aria-label', /^Output 1, Output/);
  await page.keyboard.press('v');
  await expect(page.getByTestId('results-title')).toHaveText('Output 1');
  // The results are named with their size, and the grid Glide mirrors its cells in has the row and column counts.
  await expect(page.getByRole('region', { name: 'Results of Output 1: 4 rows, 4 columns' })).toBeVisible();
  const grid = page.locator('table[role="grid"]');
  await expect(grid).toHaveAttribute('aria-label', 'Results of Output 1: 4 rows, 4 columns');
  await expect(grid).toHaveAttribute('aria-rowcount', '5');
  await expect(grid).toHaveAttribute('aria-colcount', '4');

  const download = page.waitForEvent('download');
  await page.keyboard.press('e');
  const file = await download;
  expect(file.suggestedFilename()).toBe('Output 1.csv');
  const csv = await textOf(file);
  expect(csv.split('\n')[1]).toBe('1,Ada Lovelace,ADA@example.com,2024-01-31');
  await expect(page.getByTestId('announce-polite')).toContainText('Exported Output 1.csv (4 rows).');
});

test('wires are drawn and taken away from the keyboard, and Tab moves between nodes', async ({ page }) => {
  await openApp(page);
  await addWithA(page, 'customers.csv');
  await addStepWithT(page, 'Trim whitespace');
  await expect(page.getByTestId('wire-customers.csv->Transform 1')).toBeAttached();
  await page.keyboard.press('f');
  await expect(page.locator('.react-flow__edge').first()).toHaveAttribute('aria-label', 'Wire from customers.csv into Transform 1');

  // C on the source, then Enter on the Transform it already feeds, takes the wire away.
  await page.keyboard.press('ArrowLeft');
  await expect(focusedNode(page)).toHaveAttribute('aria-label', /^customers\.csv/);
  await page.keyboard.press('c');
  await expect(page.getByTestId('canvas-notice')).toContainText('Wiring from customers.csv.');
  await expect(node(page, 'customers.csv').locator('xpath=..')).toHaveClass(/is-wiring-from/);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('wire-customers.csv->Transform 1')).not.toBeAttached();
  await expect(page.getByTestId('canvas-notice')).toContainText('Removed the wire from customers.csv into Transform 1.');
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'unwired');
  await expect(focusedNode(page)).toHaveAttribute('aria-label', /^Transform 1, .*not connected yet/);

  // Escape stops wiring without changing anything.
  await page.keyboard.press('c');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('canvas-notice')).toContainText('Wiring cancelled.');

  // Shift+Tab reaches the source (selecting it, so the inspector follows); C, Tab and Enter wire it back.
  await page.keyboard.press('Shift+Tab');
  await expect(focusedNode(page)).toHaveAttribute('aria-label', /^customers\.csv/);
  await expect(page.getByTestId('inspector')).toContainText('customers.csv');
  await page.keyboard.press('c');
  await page.keyboard.press('Tab');
  await expect(focusedNode(page)).toHaveAttribute('aria-label', /^Transform 1/);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('wire-customers.csv->Transform 1')).toBeAttached();
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('announce-polite')).toContainText('Wired customers.csv into Transform 1.');

  // A wire takes the focus too (Tab reaches it before the nodes), and Enter then Delete removes it.
  const wire = page.locator('.react-flow__edge').first();
  await wire.focus();
  await expect(wire).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('wire-customers.csv->Transform 1')).not.toBeAttached();
});

test('the query designer joins tables and moves fields without dragging', async ({ page }) => {
  await openApp(page);
  await addWithA(page, 'shop-customers.csv');
  await addWithA(page, 'shop-orders.csv');
  await page.keyboard.press('ArrowUp');
  await expect(focusedNode(page)).toHaveAttribute('aria-label', /^shop-customers\.csv/);

  // Add node › Query from the toolbar's menu, by keyboard: the designer opens on the selected source.
  await page.getByRole('button', { name: 'Add', exact: true }).press('Enter');
  const search = page.getByLabel('Search steps and nodes');
  await expect(search).toBeFocused();
  // Down from the search moves along the items; End lands on the last step. Typing narrows them instead.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  await search.fill('query');
  await expect(page.getByRole('menuitem').first()).toHaveText(/Query/);
  await search.press('Enter');
  await expect(page.getByTestId('query-designer')).toBeVisible();

  // Add table › shop-orders.csv.
  await page.getByRole('button', { name: 'Add table' }).press('ArrowDown');
  await page.getByRole('menuitem', { name: /shop-orders\.csv/ }).press('Enter');
  await expect(page.getByTestId('query-table-2')).toBeVisible();
  await expect(page.getByTestId('query-cross-join')).toBeVisible();

  // Enter on a field: join it to the same-named field of the other table.
  const customerId = page.getByTestId('query-field-1-customer_id').getByRole('button', { name: 'customer_id' });
  await customerId.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'shop-customers.csv.customer_id' });
  await expect(dialog.getByRole('button', { name: 'Add to the grid' })).toBeFocused();
  await expect(dialog.getByLabel('Join to')).toHaveValue('1:customer_id');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Add join' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).not.toBeAttached();
  await expect(customerId).toBeFocused();
  await expect(page.getByTestId('query-join-line')).toHaveCount(1);
  await expect(page.getByTestId('query-cross-join')).not.toBeAttached();
  await expect(page.getByTestId('query-join')).toContainText('shop-customers.csv.customer_id = shop-orders.csv.customer_id');

  // Enter, Enter adds a field to the grid; two fields, then Alt+Right moves the first after the second.
  await customerId.press('Enter');
  await page.keyboard.press('Enter');
  const name = page.getByTestId('query-field-1-name').getByRole('button', { name: 'name' });
  await name.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('grid-field-1')).toContainText('customer_id');
  await expect(page.getByTestId('grid-field-2')).toContainText('name');
  await page.getByRole('group', { name: 'customer_id, column 1 of 2' }).press('Alt+ArrowRight');
  await expect(page.getByTestId('grid-field-1')).toContainText('name');
  await expect(page.getByTestId('grid-field-2')).toContainText('customer_id');
  await expect(page.getByRole('group', { name: 'customer_id, column 2 of 2' })).toBeFocused();

  // The arrow keys move a focused table.
  const table = page.getByTestId('query-table-2');
  const before = (await table.boundingBox())!;
  await page.getByRole('group', { name: 'Move shop-orders.csv with the arrow keys' }).press('ArrowDown');
  await expect.poll(async () => (await table.boundingBox())!.y).toBeCloseTo(before.y + 16, 0);

  // Back on the canvas the Query has the keyboard, and Enter opens it in its designer again.
  await page.getByRole('button', { name: 'Back to canvas' }).press('Enter');
  await expect(focusedNode(page)).toHaveAttribute('aria-label', /^Query 1, Query, 2 tables/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Query designer for Query 1' })).toBeFocused();
});

test('dialogs start on their field, keep Tab inside and give focus back to what opened them', async ({ page }) => {
  await openApp(page);
  const projectMenu = page.getByTestId('project-menu');
  await projectMenu.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox')).toBeFocused();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeAttached();
  await expect(projectMenu).toBeFocused();

  await page.getByTestId('help-menu').press('Enter');
  await expect(page.getByRole('menuitem', { name: 'User guide' })).toBeFocused();
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).press('Enter');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' }).getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('help-menu')).toBeFocused();
});

test('a node that breaks is announced, and with reduced motion nothing animates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await addWithA(page, 'customers.csv');
  await addStepWithT(page, 'Trim whitespace');
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  // A step that removes a column that doesn't exist breaks Transform 1.
  await page.evaluate(() => {
    const { store } = globalThis.__puddle as unknown as {
      store: { getState(): { apply(edit: (p: { nodes: Array<{ name: string; type: string; steps?: unknown[] }> }) => unknown): void } };
    };
    store.getState().apply((p) => ({
      ...p,
      nodes: p.nodes.map((n) => (n.name === 'Transform 1' ? { ...n, steps: [{ id: 'st1', type: 'removeColumns', label: 'Remove phone', enabled: true, params: { columns: ['phone'] } }] } : n)),
    }));
  });
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'error');
  await expect(page.getByTestId('announce-assertive')).toContainText('Transform 1 is broken:');

  const durations = await page.evaluate(() => {
    const button = document.querySelector('.ui-btn')!;
    const nodeCard = document.querySelector('.ui-node')!;
    return [getComputedStyle(button).transitionDuration, getComputedStyle(nodeCard).transitionDuration];
  });
  for (const d of durations) for (const part of d.split(',')) expect(parseFloat(part)).toBeLessThan(0.001);
});
