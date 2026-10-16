import { expect, test } from '@playwright/test';
import { addFiles, fixture, node, openApp } from './helpers/app';

async function dragWire(page: import('@playwright/test').Page, from: string, to: string) {
  const out = node(page, from).locator('.react-flow__handle.source');
  const inp = node(page, to).locator('.react-flow__handle.target').first();
  await out.hover();
  await page.mouse.down();
  const box = (await inp.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('nodes are added after the selection, wired, and laid out', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('wire-customers.csv->Transform 1')).toBeAttached();

  await page.getByRole('button', { name: 'Add node' }).click();
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

test('dragging a wire connects nodes, and a wire that would make a loop is refused with a reason', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  // Regression (flaky on a busy machine): adding a file is asynchronous and selects its node when it lands. If it
  // landed after the canvas click below, the Transform was added after the source and wired to it. Wait until the
  // source is in and selected, so the click really leaves nothing selected.
  await expect(page.getByTestId('inspector-source')).toBeVisible();
  await page.getByTestId('canvas').click({ position: { x: 20, y: 20 } });
  await expect(page.getByTestId('inspector-source')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'unwired');

  await dragWire(page, 'customers.csv', 'Transform 1');
  await expect(page.getByTestId('wire-customers.csv->Transform 1')).toBeAttached();
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');

  await page.getByTestId('canvas').click({ position: { x: 20, y: 20 } });
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await dragWire(page, 'Transform 1', 'Transform 2');
  await expect(page.getByTestId('wire-Transform 1->Transform 2')).toBeAttached();
  // Transform 1 already has an input; a second one from Transform 2 would loop.
  await dragWire(page, 'Transform 2', 'Transform 1');
  await expect(page.getByTestId('canvas-notice')).toBeVisible();
  await expect(page.getByTestId('wire-Transform 2->Transform 1')).not.toBeAttached();
});

test('hovering a wire shows the columns it carries', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add node' }).click();
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
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await page.getByRole('button', { name: 'Add node' }).click();
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

test('deleting a node removes it and its wires, and undo brings them back', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await node(page, 'Output 1').click();
  await page.keyboard.press('Delete');
  await expect(node(page, 'Output 1')).not.toBeAttached();
  await expect(page.getByTestId('wire-customers.csv->Output 1')).not.toBeAttached();
  await page.keyboard.press('Control+z');
  await expect(node(page, 'Output 1')).toBeAttached();
  await expect(page.getByTestId('wire-customers.csv->Output 1')).toBeAttached();
});
