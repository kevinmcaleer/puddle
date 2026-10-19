import { expect, test, type Page } from '@playwright/test';
import { addStepWithT, fixture, node, openApp } from './helpers/app';

/** The node is selected on the canvas (the inspector shows it). */
const isSelected = (page: Page, name: string) => expect(node(page, name).locator('.ui-node')).toHaveClass(/is-selected/);

const store = (page: Page) =>
  page.evaluate(() => {
    const s = (globalThis.__puddle as unknown as { store: { getState(): { history: { past: unknown[]; present: { nodes: Array<{ name: string; position: { x: number; y: number } }>; edges: unknown[] } } } } }).store.getState();
    return { undoSteps: s.history.past.length, nodes: s.history.present.nodes.map((n) => n.name), positions: s.history.present.nodes.map((n) => [n.name, n.position.x, n.position.y]) };
  });

/** Press A and choose shop-orders.csv in the file chooser it opens. */
async function addOrders(page: Page) {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('a');
  await (await chooser).setFiles([fixture('shop-orders.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok');
}

test('? lists every shortcut by area, in mono, and Escape closes it', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Shift+?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  for (const area of ['General', 'Canvas', 'Results', 'Steps']) await expect(dialog.getByRole('region', { name: area })).toBeVisible();
  await expect(dialog.locator('[data-shortcut="layout"] + dd kbd')).toHaveText('L');
  await expect(dialog.getByRole('region', { name: 'Results' }).locator('[data-shortcut="pin"]')).toHaveText('Pin or unpin the results');
  await expect(dialog.locator('[data-shortcut="pin"] + dd kbd')).toHaveText('P');
  // Keys don't run shortcuts behind the dialog.
  await page.keyboard.press('a');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeAttached();
  expect((await store(page)).nodes).toEqual([]);

  // The Help menu opens it too, and the item names the key.
  await page.getByTestId('help-menu').click();
  const item = page.getByRole('menuitem', { name: 'Keyboard shortcuts' });
  await expect(item.locator('kbd')).toHaveText('?');
  await item.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).not.toBeAttached();
});

test('building a flow from the keyboard: add, layout, move along the wires, view, undo and redo', async ({ page }) => {
  await openApp(page);
  await addOrders(page);
  await isSelected(page, 'shop-orders.csv');

  // T (a step from the Add menu) and O add after the selected node, and select what they add.
  await addStepWithT(page, 'Trim whitespace');
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('wire-shop-orders.csv->Transform 1')).toBeAttached();
  await isSelected(page, 'Transform 1');
  await page.keyboard.press('o');
  await expect(page.getByTestId('wire-Transform 1->Output 1')).toBeAttached();
  await isSelected(page, 'Output 1');

  // Arrows follow the wires; F puts the keyboard on the canvas first.
  await page.keyboard.press('f');
  await expect(page.getByRole('main', { name: 'Canvas' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await isSelected(page, 'Transform 1');
  await page.keyboard.press('o');
  await isSelected(page, 'Output 2');
  await expect(page.getByTestId('wire-Transform 1->Output 2')).toBeAttached();

  // L lays the flow out (one undo step); Ctrl+Z and Ctrl+Shift+Z undo and redo it.
  const before = await store(page);
  await page.keyboard.press('l');
  await expect.poll(async () => (await store(page)).undoSteps).toBe(before.undoSteps + 1);
  const laidOut = (await store(page)).positions;
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await store(page)).positions).toEqual(before.positions);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await store(page)).positions).toEqual(laidOut);

  // Up and down move between the two Outputs fed by Transform 1; left and right along the wires.
  const y = (n: string) => laidOut.find((p) => p[0] === n)![2] as number;
  expect(y('Output 1')).not.toBe(y('Output 2'));
  const [toward, back] = y('Output 1') < y('Output 2') ? ['ArrowUp', 'ArrowDown'] : ['ArrowDown', 'ArrowUp'];
  await page.keyboard.press(toward);
  await isSelected(page, 'Output 1');
  await page.keyboard.press(back);
  await isSelected(page, 'Output 2');
  await page.keyboard.press('ArrowLeft');
  await isSelected(page, 'Transform 1');
  await page.keyboard.press('ArrowLeft');
  await isSelected(page, 'shop-orders.csv');
  await page.keyboard.press('ArrowRight');
  await isSelected(page, 'Transform 1');

  // Arrows view the node they select, as a click does (and don't nudge the node). With the results pinned they only
  // select, and V moves the pin to the selection.
  await expect(page.getByTestId('results-title')).toHaveText('Transform 1');
  expect((await store(page)).positions).toEqual(laidOut);
  await page.keyboard.press('p');
  await page.keyboard.press('ArrowLeft');
  await isSelected(page, 'shop-orders.csv');
  await expect(page.getByTestId('results-title')).toHaveText('Transform 1');
  await page.keyboard.press('v');
  await expect(page.getByTestId('results-title')).toHaveText('shop-orders.csv');
  await page.keyboard.press('p');
  await page.keyboard.press('ArrowRight');

  // Regression: an arrow on a node focused by clicking it used to nudge the node; now it only moves the selection.
  await node(page, 'shop-orders.csv').click();
  await page.keyboard.press('ArrowRight');
  await isSelected(page, 'Transform 1');
  await page.keyboard.press('ArrowDown');
  expect((await store(page)).positions).toEqual(laidOut);
});

test('/ opens a step search with its search focused, and Enter adds the first match', async ({ page }) => {
  await openApp(page);
  await addOrders(page);
  // On a source, / opens the Add menu: the step becomes a Transform after it.
  await page.keyboard.press('/');
  const add = page.getByLabel('Search steps and nodes');
  await expect(add).toBeFocused();
  await add.fill('trim');
  await expect(page.getByRole('menuitem')).toHaveCount(1);
  // Typing in the search runs no shortcuts (t, o, l are in "trim" and "total").
  await add.press('Enter');
  await expect(page.getByRole('menu')).not.toBeAttached();
  await isSelected(page, 'Transform 1');
  await expect(page.getByTestId('inspector').locator('.ui-step')).toHaveCount(1);
  expect((await store(page)).nodes).toEqual(['shop-orders.csv', 'Transform 1']);

  // On a Transform, / opens the inspector's Add step menu, which adds to that node.
  await page.keyboard.press('/');
  const search = page.getByLabel('Search steps');
  await expect(search).toBeFocused();
  await search.fill('case');
  await search.press('Enter');
  await expect(page.getByTestId('inspector').locator('.ui-step')).toHaveCount(2);
  expect((await store(page)).nodes).toEqual(['shop-orders.csv', 'Transform 1']);
  await expect(page.getByRole('button', { name: 'Add step' })).toHaveAttribute('title', 'Add a step to this node (/)');
});

// Regression (WebKit): a node added with T takes the focus once React Flow has drawn it, which in WebKit could be after
// / had opened the step search. The node took the focus from the search, and the Enter meant for it opened the node.
test('a step search opened before the new node is drawn keeps the focus', async ({ page }) => {
  await openApp(page);
  await addOrders(page);
  // Nodes can't take the focus while hidden: this holds the new node back the way a slow first draw does.
  const hidden = await page.addStyleTag({ content: '.react-flow__node { visibility: hidden !important; }' });
  await page.keyboard.press('t');
  await page.getByLabel('Search steps and nodes').fill('Trim whitespace');
  await page.getByLabel('Search steps and nodes').press('Enter');
  await expect(page.getByLabel('Node name')).toHaveValue('Transform 1');
  await page.keyboard.press('/');
  const search = page.getByLabel('Search steps');
  await expect(search).toBeFocused();
  await hidden.evaluate((el) => (el as Element).remove());
  // A few frames for the node to be drawn, while it would still be trying to take the focus.
  await page.evaluate(() => new Promise<void>((done) => { let n = 0; const tick = () => (++n < 5 ? requestAnimationFrame(tick) : done()); requestAnimationFrame(tick); }));
  await expect(search).toBeFocused();
  await search.fill('case');
  await search.press('Enter');
  await expect(page.getByTestId('inspector').locator('.ui-step')).toHaveCount(2);
});

test('G groups the selected nodes into one card; with too few selected it says how', async ({ page }) => {
  await openApp(page);
  await addOrders(page);
  await page.keyboard.press('g');
  await expect(page.getByTestId('canvas-notice')).toContainText('Select two or more nodes to group them');
  // Each Transform is a step from the Add menu's search (T), after the one before.
  for (const name of ['Transform 1', 'Transform 2']) {
    await addStepWithT(page, 'Trim whitespace', name);
    await isSelected(page, name);
    await expect(page.getByTestId('inspector').locator('.ui-step')).toHaveCount(1);
    await page.getByRole('main', { name: 'Canvas' }).focus();
  }
  await expect(node(page, 'Transform 2')).toHaveAttribute('data-status', 'ok');
  await node(page, 'Transform 1').click();
  await node(page, 'Transform 2').click({ modifiers: ['Shift'] });
  await page.keyboard.press('g');
  await expect(page.getByTestId('group-Group 1')).toBeVisible();
  await expect(node(page, 'Transform 2')).not.toBeAttached();
  await expect(page.getByTestId('wire-shop-orders.csv->Transform 1')).toBeAttached();
});

test('R and I show and hide the results and the inspector', async ({ page }) => {
  await openApp(page);
  const results = page.getByTestId('results-panel');
  await expect(results).toHaveAttribute('data-collapsed', 'false');
  await page.keyboard.press('r');
  await expect(results).toHaveAttribute('data-collapsed', 'true');
  await expect(results.getByRole('button', { name: 'Show results' })).toHaveAttribute('title', 'Show results (R)');
  await page.keyboard.press('r');
  await expect(results).toHaveAttribute('data-collapsed', 'false');

  await expect(page.getByTestId('inspector')).toBeVisible();
  await page.keyboard.press('i');
  await expect(page.getByTestId('inspector')).not.toBeAttached();
  await expect(page.getByTestId('inspector-toggle')).toHaveAttribute('title', 'Show inspector (I)');
  await page.getByTestId('inspector-toggle').click();
  await expect(page.getByTestId('inspector')).toBeVisible();
  // The notes are a tab of the inspector; the Project tab holds the settings.
  await page.getByRole('tab', { name: 'Notes' }).click();
  await expect(page.getByTestId('notes-panel')).toBeVisible();
  await page.getByRole('tab', { name: 'Project' }).click();
  await expect(page.getByTestId('project-settings')).toBeVisible();
  await page.keyboard.press('i');
  await expect(page.getByTestId('inspector')).not.toBeAttached();
});

test('E exports the viewed Output and Shift+E exports all', async ({ page }) => {
  await openApp(page);
  await addOrders(page);
  await page.keyboard.press('e');
  await expect(page.getByTestId('canvas-notice')).toContainText('View an Output node to export it.');
  await page.keyboard.press('o');
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok');
  await page.keyboard.press('v');
  await expect(page.getByTestId('results-title')).toHaveText('Output 1');

  let download = page.waitForEvent('download');
  await page.keyboard.press('e');
  expect((await download).suggestedFilename()).toBe('Output 1.csv');
  await expect(page.getByTestId('canvas-notice')).toContainText('Exported Output 1.csv (5 rows).');

  download = page.waitForEvent('download');
  await page.keyboard.press('Shift+E');
  expect((await download).suggestedFilename()).toBe('Output 1.csv');
  await expect(page.getByTestId('canvas-notice')).toContainText('Exported Output 1.csv.');
  await page.getByTestId('project-menu').click();
  await expect(page.getByRole('menuitem', { name: 'Export all' }).locator('kbd')).toHaveText('Shift+E');
  await page.keyboard.press('Escape');
});

test('no shortcut fires while typing in a text field', async ({ page }) => {
  await openApp(page);
  await addOrders(page);
  await addStepWithT(page, 'Trim whitespace');
  await isSelected(page, 'Transform 1');
  const before = await store(page);

  const name = page.getByLabel('Node name');
  await name.click();
  await page.keyboard.type('atolgfvers?/i');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+E');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(name).toBeFocused();
  await expect(page.getByRole('dialog')).not.toBeAttached();
  await expect(page.getByRole('menu')).not.toBeAttached();
  await expect(page.getByTestId('inspector')).toBeVisible();
  await expect(page.getByTestId('results-panel')).toHaveAttribute('data-collapsed', 'false');
  await isSelected(page, 'Transform 1');

  await page.getByRole('tab', { name: 'Notes' }).click();
  const notes = page.getByLabel('Project notes', { exact: true }).and(page.locator('textarea'));
  await notes.click();
  await page.keyboard.type('Total: totals / orders? Look at it later.');
  await expect(notes).toHaveValue('Total: totals / orders? Look at it later.');
  await expect(page.getByRole('dialog')).not.toBeAttached();

  // Only the name typed into the field changed: no node was added, moved, grouped or removed.
  const after = await store(page);
  expect(after.nodes).toEqual(['shop-orders.csv', 'Transform 1atolgfvers?/i']);
  expect(after.positions.map((p) => p.slice(1))).toEqual(before.positions.map((p) => p.slice(1)));
});
