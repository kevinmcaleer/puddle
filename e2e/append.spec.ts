import { expect, test, type Page } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp, selectNode } from './helpers/app';

/** Add the files, select them in order (click, then Shift+click), and append them from the menu or the selection bar. */
async function appendFiles(page: Page, files: string[], via: 'menu' | 'selection bar' = 'menu') {
  await openApp(page);
  await addFiles(page, files.map(fixture));
  for (const f of files) await expect(node(page, f)).toHaveAttribute('data-status', 'ok');
  await selectNode(page, files[0]!);
  for (const f of files.slice(1)) await selectNode(page, f, ['Shift']);
  if (via === 'menu') {
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: /Append/ }).click();
  } else await page.getByTestId('group-bar').getByRole('button', { name: 'Append these' }).click();
}

const columns = (page: Page) => page.getByTestId('inspector-columns').locator('.ui-col');
const port = (page: Page, n: number) => node(page, 'Append 1').locator(`.react-flow__handle.target[data-handleid="${n}"]`);

test('appending customers to more customers with an extra column stacks the rows in input order', async ({ page }) => {
  await appendFiles(page, ['customers.csv', 'customers-more.csv']);
  const append = node(page, 'Append 1');
  await expect(append).toHaveAttribute('data-status', 'ok');
  await expect(append).toContainText('Append · 2 inputs');

  // Inputs are numbered on the node, in the order the files were selected, with a spare third input.
  await expect(page.getByTestId('wire-customers.csv->Append 1')).toHaveAttribute('data-port', '0');
  await expect(page.getByTestId('wire-customers-more.csv->Append 1')).toHaveAttribute('data-port', '1');
  await expect(port(page, 0)).toHaveText('1');
  await expect(port(page, 1)).toHaveText('2');
  await expect(port(page, 2)).toHaveText('3');
  await expect(port(page, 2)).toHaveAttribute('aria-label', /Input 3/);

  // The inspector lists the inputs and where each column comes from.
  const inspector = page.getByTestId('inspector-append');
  await expect(inspector.getByTestId('append-inputs')).toContainText('1customers.csv2customers-more.csv');
  await expect(columns(page)).toHaveText(['id', 'name', 'email', 'joined', 'phone']);
  await expect(inspector.getByTestId('append-column-from')).toHaveText(['all inputs', 'all inputs', 'all inputs', 'all inputs', 'only input 2']);
  await append.click();
  await expectRows(page, 6);

  // A source column names each row's input.
  await inspector.getByLabel('Add a column naming each row’s input').check();
  await expect(columns(page)).toHaveText(['id', 'name', 'email', 'joined', 'phone', 'source']);
  await inspector.getByLabel('Column name').fill('phone');
  await inspector.getByLabel('Column name').press('Enter');
  await expect(inspector).toContainText('There’s already a column called phone.');
  await inspector.getByLabel('Column name').fill('file');
  await inspector.getByLabel('Column name').press('Enter');
  await expect(columns(page).last()).toHaveText('file');
  await expect(append).toHaveAttribute('data-status', 'ok');
  await expectRows(page, 6);

  // Moving input 2 up swaps the wires; undo puts them back.
  await inspector.getByRole('button', { name: 'Move input 2 up' }).click();
  await expect(page.getByTestId('wire-customers-more.csv->Append 1')).toHaveAttribute('data-port', '0');
  await expect(inspector.getByTestId('append-column-from').nth(4)).toHaveText('only input 1');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('wire-customers-more.csv->Append 1')).toHaveAttribute('data-port', '1');

  // By position: same columns here, since the two files share their first four.
  await inspector.getByLabel('Match columns').selectOption({ label: 'By position' });
  await expect(append).toContainText('Append · 2 inputs by position');
  await expect(append).toHaveAttribute('data-status', 'ok');
  await expectRows(page, 6);
});

test('a third file dragged onto the spare input is stacked last, and another spare input appears', async ({ page }) => {
  await appendFiles(page, ['customers.csv', 'customers-more.csv'], 'selection bar');
  await expect(node(page, 'Append 1')).toHaveAttribute('data-status', 'ok');
  await addFiles(page, [fixture('shop-customers.csv')]);
  await expect(node(page, 'shop-customers.csv')).toHaveAttribute('data-status', 'ok');

  // The new source lands below the others, under the results: bring every node into view first.
  await page.getByRole('button', { name: 'Fit View' }).click();
  let last = '';
  await expect(async () => {
    // Fit View animates: wait until the input stops moving.
    const now = JSON.stringify(await port(page, 2).boundingBox());
    const before = last;
    last = now;
    expect(now).toBe(before);
  }).toPass({ intervals: [150] });
  await node(page, 'shop-customers.csv').locator('.react-flow__handle.source').hover();
  await page.mouse.down();
  const box = (await port(page, 2).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('wire-shop-customers.csv->Append 1')).toHaveAttribute('data-port', '2');
  await expect(port(page, 3)).toHaveText('4');
  await expect(node(page, 'Append 1')).toContainText('Append · 3 inputs');

  await selectNode(page, 'Append 1');
  await expect(columns(page)).toHaveText(['id', 'name', 'email', 'joined', 'phone', 'customer_id', 'status']);
  await expect(page.getByTestId('append-column-from').last()).toHaveText('only input 3');
  await expectRows(page, 11);
});

test('a type clash is explained before the preview runs, on the node and in the inspector', async ({ page }) => {
  await appendFiles(page, ['customers.csv', 'customers-codes.csv'], 'selection bar');
  const append = node(page, 'Append 1');
  const message = 'id is a number in customers.csv and text in customers-codes.csv; change one with Change type.';
  await expect(append).toHaveAttribute('data-status', 'error');
  await expect(append).toContainText(message);
  await expect(page.getByTestId('wire-customers-codes.csv->Append 1')).toHaveAttribute('data-state', 'broken');
  await expect(page.getByTestId('wire-customers.csv->Append 1')).not.toHaveAttribute('data-state', 'broken');
  await expect(page.getByTestId('append-clash')).toContainText(message);
  // Viewing it shows the reason, not a table.
  await append.click();
  await expect(page.getByTestId('results-table')).not.toBeAttached();
});

test('unwiring an input leaves the append waiting for a second one, and undo wires it back', async ({ page }) => {
  await appendFiles(page, ['customers.csv', 'customers-more.csv']);
  await expect(node(page, 'Append 1')).toHaveAttribute('data-status', 'ok');
  await page.getByTestId('canvas').click({ position: { x: 20, y: 20 } });
  await page.getByTestId('wire-customers.csv->Append 1').click({ force: true });
  await page.keyboard.press('Delete');
  await expect(node(page, 'Append 1')).toHaveAttribute('data-status', 'unwired');
  await expect(node(page, 'Append 1')).toContainText('Append · 1 input');
  // The second input keeps its number.
  await expect(page.getByTestId('wire-customers-more.csv->Append 1')).toHaveAttribute('data-port', '1');
  await page.keyboard.press('Control+z');
  await expect(node(page, 'Append 1')).toHaveAttribute('data-status', 'ok');
});
