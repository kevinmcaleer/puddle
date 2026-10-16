import { expect, test, type Page } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp } from './helpers/app';

const settings = (page: Page) => page.getByTestId('rule-settings');
const ruleRow = (page: Page, type: string) => page.getByTestId(`rule-${type}`).locator('.ui-rule');

async function addRule(page: Page, title: string) {
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('menuitem', { name: title, exact: true }).click();
}

/** Orders and customers on the canvas, with customers wired into Transform 1. */
async function shop(page: Page) {
  await openApp(page);
  await addFiles(page, [fixture('shop-orders.csv'), fixture('shop-customers.csv')]);
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'shop-customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, 'shop-customers.csv').click();
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  await node(page, 'shop-orders.csv').click();
  await expectRows(page, 5);
}

test('a referential rule reads another node, draws a dashed reference, and shows an error when that node breaks', async ({ page }) => {
  await shop(page);
  // Only nodes a reference is drawn between get its hidden ends, so wire ports stay the only handles elsewhere.
  await expect(page.locator('.puddle-ref-handle')).toHaveCount(0);
  await addRule(page, 'Exists in another node');
  await expect(settings(page).getByText('Pick a node first.')).toBeVisible();
  await settings(page).getByRole('button', { name: 'customer_id', exact: true }).click();
  await settings(page).getByLabel('Exists in node').selectOption({ label: 'Transform 1' });
  // The second picker lists the other node's columns.
  await settings(page).getByRole('button', { name: 'customer_id', exact: true }).nth(1).click();

  const row = ruleRow(page, 'referential');
  await expect(row).toContainText('Every customer_id exists in Transform 1.customer_id');
  await expect(row).toHaveAttribute('data-status', 'fail', { timeout: 20_000 });
  await expect(row).toContainText('1 of 5');

  // A dashed reference from the node it reads, which isn't a wire.
  const ref = page.getByTestId('ref-Transform 1->shop-orders.csv');
  await expect(ref).toBeAttached();
  await expect(ref).toHaveClass(/ui-wire--ref/);
  await expect(node(page, 'Transform 1').locator('.puddle-ref-handle.source')).toHaveCount(1);
  await expect(node(page, 'shop-orders.csv').locator('.puddle-ref-handle.target')).toHaveCount(1);
  await expect(node(page, 'shop-customers.csv').locator('.puddle-ref-handle')).toHaveCount(0);

  await row.getByRole('button', { name: 'Show failing rows' }).click();
  await expectRows(page, 1);
  await page.getByRole('button', { name: 'Show all rows' }).click();
  await expectRows(page, 5);

  // Unwire the node it reads: the rule can't run, which is not a pass.
  await page.getByTestId('wire-shop-customers.csv->Transform 1').click({ force: true });
  await page.keyboard.press('Delete');
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'unwired');
  await node(page, 'shop-orders.csv').click();
  await expect(row).toContainText('Can’t run', { timeout: 20_000 });
  await expect(row).toContainText('Transform 1 isn’t connected yet, so this rule can’t be checked.');
  await expect(node(page, 'shop-orders.csv')).toHaveAttribute('data-rules', 'fail');

  // Wired back (undo), it re-runs and fails on the data again.
  await page.keyboard.press('Control+z');
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  await node(page, 'shop-orders.csv').click();
  await expect(row).toContainText('1 of 5', { timeout: 20_000 });
});

test('row count, custom expression and length rules', async ({ page }) => {
  await shop(page);

  await addRule(page, 'Row count');
  const count = ruleRow(page, 'rowCount');
  await expect(count).toContainText('At least 1 row');
  await expect(count).toHaveAttribute('data-status', 'pass', { timeout: 20_000 });
  await expect(count).toContainText('5 rows');
  await settings(page).getByLabel('Rows').fill('6');
  await settings(page).getByLabel('Rows').press('Enter');
  await expect(count).toHaveAttribute('data-status', 'fail', { timeout: 20_000 });
  await expect(count).toContainText('This rule is about the whole table, so there are no failing rows to show.');
  await expect(count.getByRole('button', { name: 'Show failing rows' })).toHaveCount(0);
  await settings(page).getByLabel('Row count').selectOption('sameAs');
  await settings(page).getByLabel('Node').selectOption({ label: 'shop-customers.csv' });
  await expect(count).toContainText('Same number of rows as shop-customers.csv');
  await expect(count).toHaveAttribute('data-status', 'pass', { timeout: 20_000 });
  await expect(page.getByTestId('ref-shop-customers.csv->shop-orders.csv')).toBeAttached();

  await addRule(page, 'Custom expression');
  await expect(settings(page).getByText('Write an expression.')).toBeVisible();
  const expr = settings(page).getByRole('combobox', { name: 'Every row satisfies' });
  await expr.fill("total >= 5 AND status <> 'pending'");
  await expr.blur();
  const custom = ruleRow(page, 'expression');
  await expect(custom).toContainText('Custom expression');
  await expect(custom.locator('code')).toHaveText("total >= 5 AND status <> 'pending'");
  await expect(custom).toHaveAttribute('data-status', 'fail', { timeout: 20_000 });
  await expect(custom).toContainText('3 of 5');
  await custom.getByRole('button', { name: 'Show failing rows' }).click();
  await expectRows(page, 3);
  await page.getByRole('button', { name: 'Show all rows' }).click();

  // The same safety checks as expression columns.
  await expr.fill('total > 0; DROP TABLE x');
  await expr.blur();
  await expect(custom).toContainText('Can’t run', { timeout: 20_000 });
  await expect(custom).toContainText(/;/);

  await addRule(page, 'Length');
  await settings(page).getByRole('button', { name: 'status', exact: true }).click();
  await settings(page).getByLabel('Length is').selectOption('exactly');
  await settings(page).getByLabel('Characters').fill('7');
  await settings(page).getByLabel('Characters').press('Enter');
  const length = ruleRow(page, 'length');
  await expect(length).toContainText('status is exactly 7 characters');
  await expect(length).toHaveAttribute('data-status', 'pass', { timeout: 20_000 });
  await settings(page).getByLabel('Length is').selectOption('atMost');
  await settings(page).getByLabel('Characters').fill('6');
  await settings(page).getByLabel('Characters').press('Enter');
  await expect(length).toContainText('5 of 5', { timeout: 20_000 });
});

test('reads as a whole number, with its failing rows', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('types.csv')]);
  await expect(node(page, 'types.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, 'types.csv').click();
  await expectRows(page, 7);
  await addRule(page, 'Reads as a type');
  await settings(page).getByRole('button', { name: 'value', exact: true }).click();
  await settings(page).getByLabel('Reads as').selectOption('integer');
  const row = ruleRow(page, 'readsAs');
  await expect(row).toContainText('value reads as a whole number');
  await expect(row).toContainText('3 of 7', { timeout: 20_000 });
  await row.getByRole('button', { name: 'Show failing rows' }).click();
  await expectRows(page, 3);
});
