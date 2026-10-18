import { expect, test } from '@playwright/test';
import { addFiles, addStepNode, fixture, node, openApp } from './helpers/app';

async function dragWire(page: import('@playwright/test').Page, from: string, to: string) {
  const out = node(page, from).locator('.react-flow__handle.source');
  const inp = node(page, to).locator('.react-flow__handle.target').first();
  // Press where the handle is now, measured just before, rather than where hover() last found it.
  const start = (await out.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  const box = (await inp.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('nodes are added after the selection, wired, and laid out', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
  await addStepNode(page, 'Trim whitespace');
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('wire-customers.csv->Transform 1')).toBeAttached();

  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await expect(page.getByTestId('wire-Transform 1->Output 1')).toBeAttached();
  await node(page, 'Output 1').click();
  await expect(page.getByTestId('results-title')).toHaveText('Output 1');
  await expect(page.getByTestId('wire-Transform 1->Output 1')).toHaveAttribute('data-state', 'active');

  const before = await node(page, 'Output 1').boundingBox();
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await expect.poll(async () => (await node(page, 'Output 1').boundingBox())?.x).not.toBe(before?.x);
  // Auto layout is one undo step.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await node(page, 'Output 1').boundingBox())?.x).toBe(before?.x);
});

test('the minimap appears only once a node runs off the visible canvas, and the inspector keeps its Project tab beside a node', async ({ page }) => {
  await openApp(page);
  const minimap = page.locator('.react-flow__minimap');
  await expect(minimap).toHaveCount(0);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
  await addStepNode(page, 'Trim whitespace');
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  await expect(minimap).toHaveCount(0);

  // Panned until a node leaves the view, the map appears; fit view brings every node back and it goes.
  const pane = page.locator('.react-flow__pane');
  const box = (await pane.boundingBox())!;
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + box.height - 20, { steps: 10 });
  await page.mouse.up();
  await expect(minimap).toBeVisible();
  await page.getByRole('button', { name: /fit view/i }).click();
  await expect(minimap).toHaveCount(0);

  // With a node selected the inspector shows it; the Project tab is a click away and back.
  await expect(page.getByTestId('inspector-transform')).toBeVisible();
  await page.getByRole('tab', { name: 'Project' }).click();
  await expect(page.getByTestId('project-settings')).toBeVisible();
  await expect(page.getByTestId('display-settings')).toBeVisible();
  await page.getByRole('tab', { name: 'Node' }).click();
  await expect(page.getByTestId('inspector-transform')).toBeVisible();
});

test('dragging a wire connects nodes, and a wire that would make a loop is refused with a reason', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  // Regression (flaky on a busy machine): adding a file is asynchronous and selects its node when it lands. If it
  // landed after the canvas click below, the Transform was added after the source and wired to it. Wait until the
  // source is in and selected, so the click really leaves nothing selected.
  await expect(page.getByTestId('inspector-source')).toBeVisible();
  await page.getByTestId('canvas').click({ position: { x: 20, y: 20 } });
  await expect(page.getByTestId('inspector-source')).toHaveCount(0);
  // With nothing selected, a step from the Add menu starts a Transform of its own, unwired.
  await addStepNode(page, 'Remove blank rows');
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'unwired');

  await dragWire(page, 'customers.csv', 'Transform 1');
  await expect(page.getByTestId('wire-customers.csv->Transform 1')).toBeAttached();
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');

  await page.getByTestId('canvas').click({ position: { x: 20, y: 20 } });
  await addStepNode(page, 'Remove blank rows', 'Transform 2');
  await dragWire(page, 'Transform 1', 'Transform 2');
  await expect(page.getByTestId('wire-Transform 1->Transform 2')).toBeAttached();
  // Regression (Firefox in CI): once wired, Transform 2 reads its input and its counts line grows the node, which
  // moves its handles. A drag started while that was happening began beside the handle and dragged the canvas
  // instead, so no connection was tried and no notice came. Wait until it has settled.
  await expect(node(page, 'Transform 2')).toHaveAttribute('data-status', 'ok');
  // Transform 1 already has an input; a second one from Transform 2 would loop.
  await dragWire(page, 'Transform 2', 'Transform 1');
  await expect(page.getByTestId('canvas-notice')).toBeVisible();
  await expect(page.getByTestId('wire-Transform 2->Transform 1')).not.toBeAttached();
});

test('hovering a wire shows the columns it carries', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok');
  const wire = page.getByTestId('wire-customers.csv->Output 1');
  const box = (await wire.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const popover = page.getByRole('tooltip');
  await expect(popover).toContainText('Columns on this wire');
  await expect(popover.locator('.ui-col')).toHaveText(['id', 'name', 'email', 'joined']);
});

test('a broken source breaks its node and dims everything downstream', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
  await addStepNode(page, 'Trim whitespace');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok');

  // A step that removes a column that doesn't exist breaks Transform 1.
  await page.evaluate(() => {
    const { store } = globalThis.__puddle as unknown as {
      store: { getState(): { apply(edit: (p: { nodes: Array<{ name: string; type: string; steps?: unknown[] }> }) => unknown): void } };
    };
    store.getState().apply((p) => ({
      ...p,
      nodes: p.nodes.map((n) =>
        n.name === 'Transform 1' ? { ...n, steps: [{ id: 'st1', type: 'removeColumns', label: 'Remove phone', enabled: true, params: { columns: ['phone'] } }] } : n,
      ),
    }));
  });
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'error');
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'blocked');
  await expect(page.getByTestId('wire-customers.csv->Transform 1')).toHaveAttribute('data-state', 'broken');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok');
});

test('a wire can be selected and deleted on its own, and undo brings it back', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok');
  await page.getByTestId('wire-customers.csv->Output 1').click({ force: true });
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('wire-customers.csv->Output 1')).not.toBeAttached();
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'unwired');
  await expect(node(page, 'customers.csv')).toBeAttached();
  await page.keyboard.press('Control+z');
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok');
});

test('deleting a node removes it and its wires, and undo brings them back', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await node(page, 'Output 1').click();
  await page.keyboard.press('Delete');
  await expect(node(page, 'Output 1')).not.toBeAttached();
  await expect(page.getByTestId('wire-customers.csv->Output 1')).not.toBeAttached();
  await page.keyboard.press('Control+z');
  await expect(node(page, 'Output 1')).toBeAttached();
  await expect(page.getByTestId('wire-customers.csv->Output 1')).toBeAttached();
});

// Regression: the canvas handed React Flow its nodes without their measured size each time the flow changed, so
// every node was hidden for a frame until measured again. A click in that frame landed on the pane and cleared the
// selection, and a node added next came out unwired (Firefox CI).
test('nodes stay visible while the flow updates around them', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  // From here on, note every time a node on the canvas is hidden.
  await page.evaluate(() => {
    const hidden: string[] = [];
    (window as unknown as { __hidden: string[] }).__hidden = hidden;
    const check = () => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node')))
        if (el.style.visibility === 'hidden' && el.dataset.seen) hidden.push(el.getAttribute('data-id') ?? '?');
        else el.dataset.seen = '1';
    };
    new MutationObserver(check).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });
  });
  await node(page, 'customers.csv').click();
  await addStepNode(page, 'Trim whitespace');
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('wire-Transform 1->Output 1')).toBeAttached();
  expect(await page.evaluate(() => (window as unknown as { __hidden: string[] }).__hidden)).toEqual([]);
});
