import { expect, test, type Page } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp } from './helpers/app';

/**
 * Orders and customers on the canvas, joined: select orders, then Shift+click customers, then Add node › Join
 * (or the selection bar's Join button).
 */
async function joinShop(page: Page, via: 'menu' | 'selection bar' = 'menu') {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv'), fixture('shop-customers.csv')]);
  await expect(node(page, 'shop-customers.csv')).toHaveAttribute('data-status', 'ok');
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok');
  await node(page, 'shop-orders.csv').click();
  await node(page, 'shop-customers.csv').click({ modifiers: ['Shift'] });
  if (via === 'menu') {
    await page.getByRole('button', { name: 'Add node' }).click();
    await page.getByRole('menuitem', { name: /Join/ }).click();
  } else await page.getByTestId('group-bar').getByRole('button', { name: 'Join these two' }).click();
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'ok');
}

/** Wait until a node sits wholly inside the visible canvas and has stopped moving (Fit View animates). */
async function expectOnCanvas(page: Page, name: string) {
  let last = '';
  await expect(async () => {
    const canvas = (await page.getByTestId('canvas').boundingBox())!;
    const box = (await node(page, name).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(canvas.y);
    expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height);
    expect(box.x).toBeGreaterThanOrEqual(canvas.x);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    const now = JSON.stringify(box);
    const before = last;
    last = now;
    expect(now).toBe(before);
  }).toPass({ intervals: [150] });
}

/** Apply an edit to the project through the store, as one undoable step. */
async function edit(page: Page, fn: string) {
  await page.evaluate((body) => {
    const { store } = globalThis.__puddle as unknown as { store: { getState(): { apply(edit: (p: unknown) => unknown): void } } };
    store.getState().apply(new Function('p', body) as (p: unknown) => unknown);
  }, fn);
}

test('joining two sources: wired left and right, matched on a shared key, with every join type', async ({ page }) => {
  await joinShop(page);
  await expect(page.getByTestId('wire-shop-orders.csv->Join 1')).toHaveAttribute('data-port', 'left');
  await expect(page.getByTestId('wire-shop-customers.csv->Join 1')).toHaveAttribute('data-port', 'right');
  await expect(node(page, 'Join 1')).toContainText('Join · Left join');

  // The inspector shows the inputs and the key it picked.
  const inspector = page.getByTestId('inspector-join');
  await expect(inspector.getByTestId('join-inputs')).toContainText('Leftshop-orders.csvRightshop-customers.csv');
  await expect(inspector.getByLabel('Left column 1')).toHaveValue('customer_id');
  await expect(inspector.getByLabel('Right column 1')).toHaveValue('customer_id');
  await expect(page.getByTestId('inspector-columns').locator('.ui-col')).toHaveText(['order_id', 'customer_id', 'total', 'status', 'name', 'status_right']);

  // Customer 5 appears twice, so the left join warns that it adds a row.
  await node(page, 'Join 1').click();
  await expectRows(page, 6);
  await expect(page.getByTestId('join-multiplied')).toContainText('5 rows on the left became 6 rows');

  for (const [label, rows] of [['Inner join', 5], ['Right join', 6], ['Full join', 7], ['Anti join', 1], ['Semi join', 4]] as const) {
    await inspector.getByLabel('Join type').selectOption({ label });
    await expect(node(page, 'Join 1')).toContainText(`Join · ${label}`);
    await expectRows(page, rows);
  }
  await expect(page.getByTestId('join-multiplied')).not.toBeAttached();
  await expect(page.getByTestId('inspector-columns').locator('.ui-col')).toHaveText(['order_id', 'customer_id', 'total', 'status']);

  // A different suffix for the clashing column.
  await inspector.getByLabel('Join type').selectOption({ label: 'Inner join' });
  await inspector.getByLabel('Suffix for clashing columns').fill('_customer');
  await inspector.getByLabel('Suffix for clashing columns').press('Enter');
  await expect(page.getByTestId('inspector-columns').locator('.ui-col')).toHaveText(['order_id', 'customer_id', 'total', 'status', 'name', 'status_customer']);

  // Swapping the inputs puts customers on the left.
  await inspector.getByRole('button', { name: 'Swap inputs' }).click();
  await expect(page.getByTestId('wire-shop-customers.csv->Join 1')).toHaveAttribute('data-port', 'left');
  await expect(page.getByTestId('inspector-columns').locator('.ui-col').first()).toHaveText('customer_id');
});

test('hovering a wire into a join shows the columns going into that input', async ({ page }) => {
  await joinShop(page, 'selection bar');
  await expect(page.getByTestId('wire-shop-orders.csv->Join 1')).toHaveAttribute('data-port', 'left');
  const wire = page.getByTestId('wire-shop-customers.csv->Join 1');
  const box = (await wire.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const popover = page.getByRole('tooltip');
  await expect(popover).toContainText('Columns into the right input');
  await expect(popover.locator('.ui-col')).toHaveText(['customer_id', 'name', 'status']);
});

test('unwiring either input marks the join unwired, and undo wires it back', async ({ page }) => {
  await joinShop(page);
  for (const from of ['shop-orders.csv', 'shop-customers.csv']) {
    // Nothing selected but the wire, so Delete removes only the wire.
    await page.getByTestId('canvas').click({ position: { x: 20, y: 20 } });
    await page.getByTestId(`wire-${from}->Join 1`).click({ force: true });
    await page.keyboard.press('Delete');
    await expect(page.getByTestId(`wire-${from}->Join 1`)).not.toBeAttached();
    await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'unwired');
    await page.keyboard.press('Control+z');
    await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'ok');
  }
});

test('a wire dragged onto the right input goes there, and a taken input is refused with a reason', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv'), fixture('shop-customers.csv')]);
  // Both sources in place before deselecting, so the Join starts with no wires.
  await expect(node(page, 'shop-customers.csv')).toHaveAttribute('data-status', 'ok');
  await page.getByTestId('canvas').click({ position: { x: 20, y: 20 } });
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: /Join/ }).click();
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'unwired');

  const drag = async (from: string, port: string) => {
    await node(page, from).locator('.react-flow__handle.source').hover();
    await page.mouse.down();
    const box = (await node(page, 'Join 1').locator(`.react-flow__handle.target[data-handleid="${port}"]`).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  await drag('shop-customers.csv', 'right');
  await expect(page.getByTestId('wire-shop-customers.csv->Join 1')).toHaveAttribute('data-port', 'right');
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'unwired');
  await drag('shop-orders.csv', 'right');
  await expect(page.getByTestId('canvas-notice')).toContainText('The right input of Join 1 already has a wire');
  await drag('shop-orders.csv', 'left');
  await expect(page.getByTestId('wire-shop-orders.csv->Join 1')).toHaveAttribute('data-port', 'left');

  // No key yet: the join says what it needs; picking one runs it.
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'error');
  await expect(node(page, 'Join 1')).toContainText('Pick the columns to match on');
  await node(page, 'Join 1').click();
  await page.getByTestId('inspector-join').getByRole('button', { name: 'Add key pair' }).click();
  await expect(page.getByTestId('inspector-join').getByLabel('Left column 1')).toHaveValue('customer_id');
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'ok');
});

test('breaking a key column upstream turns that wire red; a type mismatch is explained in the form', async ({ page }) => {
  await joinShop(page);
  // Put a Transform between customers and the join that removes customer_id.
  await edit(
    page,
    `const c = p.nodes.find((n) => n.name === 'shop-customers.csv');
     const j = p.nodes.find((n) => n.name === 'Join 1');
     const t = { id: 'drop', type: 'transform', name: 'Drop key', position: { x: c.position.x + 150, y: c.position.y + 140 }, rules: [],
       steps: [{ id: 'st1', type: 'removeColumns', label: 'Removed customer_id', enabled: true, params: { columns: ['customer_id'] } }] };
     const edges = p.edges.filter((e) => !(e.to.nodeId === j.id && e.to.port === 'right'));
     return { ...p, nodes: [...p.nodes, t], edges: [...edges, { id: 'w1', from: { nodeId: c.id }, to: { nodeId: 'drop', port: 0 } }, { id: 'w2', from: { nodeId: 'drop' }, to: { nodeId: j.id, port: 'right' } }] };`,
  );
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'error');
  await expect(node(page, 'Join 1')).toContainText('customer_id isn’t in the right input any more.');
  await expect(page.getByTestId('wire-Drop key->Join 1')).toHaveAttribute('data-state', 'broken');
  await expect(page.getByTestId('wire-shop-orders.csv->Join 1')).not.toHaveAttribute('data-state', 'broken');

  // Make it a type change instead: customer_id becomes text on the right.
  await edit(
    page,
    `return { ...p, nodes: p.nodes.map((n) => n.id === 'drop' ? { ...n, steps: [{ id: 'st1', type: 'changeType', label: 'Changed type', enabled: true, params: { columns: ['customer_id'], to: 'text', onError: 'empty' } }] } : n) };`,
  );
  await node(page, 'Join 1').click();
  const message = 'customer_id is a number on the left and text on the right; change one with Change type.';
  await expect(page.getByTestId('join-keys')).toContainText(message);
  await expect(node(page, 'Join 1')).toContainText(message);

  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'ok');
});

test('grouping the nodes before a join and ungrouping them keep it working', async ({ page }) => {
  await joinShop(page);
  await edit(
    page,
    `const c = p.nodes.find((n) => n.name === 'shop-customers.csv');
     const j = p.nodes.find((n) => n.name === 'Join 1');
     const mk = (id, name, x, step) => ({ id, type: 'transform', name, position: { x, y: c.position.y + 160 }, rules: [], steps: [step] });
     const a = mk('ta', 'Upper', c.position.x, { id: 'sa', type: 'changeCase', label: 'Upper name', enabled: true, params: { columns: ['name'], mode: 'upper' } });
     const b = mk('tb', 'Trim', c.position.x + 260, { id: 'sb', type: 'trimWhitespace', label: 'Trimmed name', enabled: true, params: { columns: ['name'] } });
     const edges = p.edges.filter((e) => !(e.to.nodeId === j.id && e.to.port === 'right'));
     return { ...p, nodes: [...p.nodes, a, b], edges: [...edges, { id: 'g1', from: { nodeId: c.id }, to: { nodeId: 'ta', port: 0 } }, { id: 'g2', from: { nodeId: 'ta' }, to: { nodeId: 'tb', port: 0 } }, { id: 'g3', from: { nodeId: 'tb' }, to: { nodeId: j.id, port: 'right' } }] };`,
  );
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'ok');
  // Upper and Trim land below the visible canvas, under the results. Clicking a node there makes Playwright scroll
  // the canvas, which React Flow undoes at once, so the click could end on the pane and select nothing. Bring every
  // node into view first, as a person would, once they show their row counts and so have their full height.
  await expect(node(page, 'Upper')).toContainText('5 rows');
  await expect(node(page, 'Trim')).toContainText('5 rows');
  await page.getByRole('button', { name: 'Fit View' }).click();
  await expectOnCanvas(page, 'Upper');
  await expectOnCanvas(page, 'Trim');
  await node(page, 'Upper').click();
  await node(page, 'Trim').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group into one node' }).click();
  await expect(node(page, 'Trim')).not.toBeAttached();
  await expect(page.getByTestId('wire-Upper->Join 1')).toHaveAttribute('data-port', 'right');
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'ok');

  await page.getByRole('button', { name: 'Ungroup into the original nodes' }).click();
  await expect(page.getByTestId('wire-Trim->Join 1')).toHaveAttribute('data-port', 'right');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('wire-Upper->Join 1')).toHaveAttribute('data-port', 'right');
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'ok');
  await node(page, 'Join 1').click();
  await expectRows(page, 6);
});
