import { expect, test, type Page } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp, selectNode } from './helpers/app';

const rules = (page: Page) => page.getByTestId('rules');
const settings = (page: Page) => page.getByTestId('rule-settings');

async function addRule(page: Page, title: string) {
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('menuitem', { name: title, exact: true }).click();
}

test('a rule checks a node, shows its failing rows and can be made a warning', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await selectNode(page, 'customers.csv');
  await expectRows(page, 4);

  await addRule(page, 'No leading or trailing spaces');
  await settings(page).getByRole('button', { name: 'name', exact: true }).click();
  const row = rules(page).locator('.ui-rule').first();
  await expect(row).toContainText('No leading or trailing spaces in name');
  await expect(row).toHaveAttribute('data-status', 'fail', { timeout: 20_000 });
  await expect(row).toContainText('Fail');
  await expect(row).toContainText('2 of 4');
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-rules', 'fail');
  await expect(node(page, 'customers.csv')).toContainText('1 rule failing');

  await row.getByRole('button', { name: 'Show failing rows' }).click();
  await expect(page.getByTestId('results-title')).toHaveText('customers.csv · failing No leading or trailing spaces in name');
  await expectRows(page, 2);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-failing-columns', 'name');

  await page.getByRole('button', { name: 'Show all rows' }).click();
  await expect(page.getByTestId('results-title')).toHaveText('customers.csv');
  await expectRows(page, 4);

  await settings(page).getByLabel('Severity').selectOption('warn');
  await expect(row).toHaveAttribute('data-status', 'warn');
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-rules', 'warn');
  await expect(node(page, 'customers.csv')).toContainText('1 warning');
});

test('a rule says what it needs, and passes once the data meets it', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await selectNode(page, 'customers.csv');

  await addRule(page, 'In a range');
  await expect(settings(page).getByText('Give a lowest or highest value.')).toBeVisible();
  await settings(page).getByRole('button', { name: 'id', exact: true }).click();
  await settings(page).getByLabel('Lowest').fill('1');
  await settings(page).getByLabel('Lowest').press('Enter');
  const row = rules(page).locator('.ui-rule').first();
  await expect(row).toContainText('id is at least 1');
  await expect(row).toHaveAttribute('data-status', 'pass', { timeout: 20_000 });
  await expect(row).toContainText('4 checked');
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-rules', 'pass');

  await settings(page).getByRole('switch', { name: 'Enabled' }).click();
  await expect(row).toHaveAttribute('data-status', 'neutral');
  await expect(node(page, 'customers.csv')).not.toHaveAttribute('data-rules', /./);

  await settings(page).getByRole('button', { name: 'Delete rule' }).click();
  await expect(page.getByText('No rules yet.')).toBeVisible();
});
