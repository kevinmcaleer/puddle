import { expect, test, type Locator } from '@playwright/test';
import { openApp } from './helpers/app';

const DBML = `// Orders and who placed them
Table users {
  id integer [pk]
  email varchar
}

Table orders {
  id integer [pk]
  user_id integer
}
`;

const centre = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test('editing on the diagram writes the DBML: a dragged ref, a renamed table, and undo', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
  const text = page.getByRole('combobox', { name: 'DBML' });
  await text.fill(DBML);
  await expect(page.getByTestId('schema-table-orders')).toBeVisible();

  // Drag orders.user_id onto users.id: the popover suggests many to one, and one Ref line is added at the end.
  const from = await centre(page.getByTestId('schema-col-orders-user_id'));
  const to = await centre(page.getByTestId('schema-col-users-id'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await expect(page.getByTestId('schema-linking')).toBeVisible();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  const ask = page.getByTestId('schema-ref-ask');
  await expect(ask.getByLabel('Kind of ref')).toHaveValue('>');
  await ask.getByRole('button', { name: 'Add ref' }).click();
  await expect(text).toHaveValue(`${DBML}\nRef: orders.user_id > users.id\n`);
  await expect(page.getByTestId('schema-ref-orders-users')).toBeAttached();

  // Double-click a table's header to rename it: the ref follows, the comment stays.
  await page.getByTestId('schema-table-users').locator('.puddle-schema-table__head').dblclick();
  const name = page.getByTestId('schema-ask').getByLabel('Table name');
  await name.fill('customers');
  await name.press('Enter');
  await expect(text).toHaveValue(`${DBML.replace('Table users {', 'Table customers {')}\nRef: orders.user_id > customers.id\n`);
  await expect(page.getByTestId('schema-table-customers')).toBeVisible();

  // Each edit is one undo step, for the text and the diagram together.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(text).toHaveValue(`${DBML}\nRef: orders.user_id > users.id\n`);
  await expect(page.getByTestId('schema-table-users')).toBeVisible();

  // A column's menu sets its settings in place.
  await page.getByTestId('schema-col-users-email').click({ button: 'right' });
  await page.getByRole('menuitemcheckbox', { name: 'Not null' }).click();
  await expect(text).toHaveValue(`${DBML.replace('email varchar', 'email varchar [not null]')}\nRef: orders.user_id > users.id\n`);
});

// Regression: the Add a ref box was placed at the dropped-on column and ran past the bottom of a short pane, and its
// focused field scrolled the diagram to show it.
test('the Add a ref box stays inside the diagram when the drop is low in it', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
  await page.getByRole('combobox', { name: 'DBML' }).fill(DBML);
  await expect(page.getByTestId('schema-table-orders')).toBeVisible();
  // At this window size the diagram's pane is short, so the dropped-on column sits in its lower half.
  const stage = (await page.getByTestId('schema-table-orders').locator('xpath=ancestor::*[contains(@class,"puddle-schema__stage")]').boundingBox())!;
  const from = await centre(page.getByTestId('schema-col-orders-user_id'));
  const to = await centre(page.getByTestId('schema-col-users-id'));
  expect(to.y).toBeGreaterThan(stage.y + stage.height / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  const ask = page.getByTestId('schema-ref-ask');
  await expect(ask).toBeVisible();
  const box = (await ask.boundingBox())!;
  const pane = (await ask.locator('xpath=..').boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(pane.y);
  expect(box.y + box.height).toBeLessThanOrEqual(pane.y + pane.height);
});
