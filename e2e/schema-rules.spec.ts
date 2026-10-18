import { expect, test } from '@playwright/test';
import { addFiles, expectRows, fixture, fixtureText, node, openApp } from './helpers/app';

test('a CSV checked against a schema table gets its rules, shows the failing rows, and keeps them as its own', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
  await page.getByRole('combobox', { name: 'DBML' }).fill(fixtureText('dbml/rules.dbml'));
  await page.getByRole('button', { name: 'Back to canvas' }).click();

  await addFiles(page, [fixture('schema-rules-customers.csv')]);
  const csv = node(page, 'schema-rules-customers.csv');
  await expect(csv).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await csv.click();
  await page.getByLabel('Check against the schema').selectOption('public.customers');
  await expect(page.getByTestId('schema-check-mapping')).toContainText('Every column of customers is found by name.');

  // The design's rules, each marked as from the schema; id repeats, so its key rule fails.
  const rules = page.getByTestId('rules');
  await expect(rules.locator('[data-from-schema]')).toHaveCount(9);
  await expect(rules.getByTestId('rule-source').first()).toHaveAttribute('aria-label', 'From the schema: customers');
  const key = rules.locator('.ui-rule').filter({ hasText: 'id is unique' }).first();
  await expect(key).toHaveAttribute('data-status', 'fail', { timeout: 20_000 });
  await expect(key).toContainText('2 of 4');
  await key.getByRole('button', { name: 'Show failing rows' }).click();
  await expectRows(page, 2);

  // Kept as the node's own rules: still there, no longer marked, and editable.
  await page.getByRole('button', { name: 'Add as rules' }).click();
  await expect(rules.locator('[data-from-schema]')).toHaveCount(0);
  await expect(rules.locator('.ui-rule')).toHaveCount(9);
  await expect(page.getByLabel('Check against the schema')).toHaveValue('');
  await key.getByRole('button', { name: 'id is unique' }).click();
  await expect(page.getByRole('button', { name: 'Delete rule' })).toBeVisible();
});
