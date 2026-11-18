import { expect, test, type Page } from '@playwright/test';
import { addFiles, fixture, node, openApp, selectNode } from './helpers/app';

const suggestions = (page: Page) => page.getByTestId('rule-suggestions');
const suggestion = (page: Page, key: string) => page.getByTestId(`suggestion-${key}`);
const showMore = (page: Page) => suggestions(page).getByRole('button', { name: /^Show more/ }).click();
const keys = (page: Page) => suggestions(page).locator('[data-testid^="suggestion-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice('suggestion-'.length)));

test('profiling suggests rules with reasons; one adds a passing rule, a dismissed one stays dismissed after reload', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(page.getByTestId('inspector-source')).toBeVisible();
  await expect(suggestion(page, 'unique:id')).toBeVisible({ timeout: 20_000 });
  // The best five show, the likeliest to be meant first; Show more lists the rest.
  expect(await keys(page)).toEqual(['unique:id', 'notEmpty:id', 'inRange:id', 'noEdgeSpaces:joined', 'unique:name']);
  await showMore(page);
  expect(await keys(page)).toEqual(['unique:id', 'notEmpty:id', 'inRange:id', 'noEdgeSpaces:joined', 'unique:name', 'notEmpty:joined', 'unique:joined']);
  await expect(suggestion(page, 'unique:id')).toContainText('id is unique');
  await expect(suggestion(page, 'unique:id')).toContainText('id has a different value in each of its 4 rows');
  await expect(suggestion(page, 'inRange:id')).toContainText('id runs from 1 to 4');
  // Suggestions don't run as rules: no rule yet, no badge on the node.
  await expect(page.getByTestId('rules')).toHaveCount(0);
  await expect(node(page, 'customers.csv')).not.toHaveAttribute('data-rules', /.+/);

  await page.getByRole('button', { name: 'Add suggested rule: id is unique' }).click();
  const rules = page.getByTestId('rules');
  await expect(rules.getByText('id is unique')).toBeVisible();
  await expect(rules.locator('.ui-rule')).toHaveAttribute('data-status', 'pass');
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-rules', 'pass');
  await expect(suggestion(page, 'unique:id')).toHaveCount(0);

  await page.getByRole('button', { name: 'Dismiss suggestion: joined is unique' }).click();
  await expect(suggestion(page, 'unique:joined')).toHaveCount(0);
  // Undo brings a dismissed suggestion back, redo dismisses it again.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(suggestion(page, 'unique:joined')).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(suggestion(page, 'unique:joined')).toHaveCount(0);

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<unknown>((resolve) => {
            const req = indexedDB.open('puddle');
            req.onsuccess = () => {
              const get = req.result.transaction('projects').objectStore('projects').get(localStorage.getItem('puddle.lastProject')!);
              get.onsuccess = () => resolve((get.result as { nodes: { dismissedSuggestions?: string[] }[] } | undefined)?.nodes[0]?.dismissedSuggestions);
            };
          }),
      ),
    )
    .toEqual(['unique:joined']);

  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('results-detached').getByRole('button', { name: 'Choose file' }).click();
  await (await chooser).setFiles(fixture('customers.csv'));
  // The click waits for the file to be read: on a node still settling (its counts arriving, the card growing) a
  // slower browser can take the press as the start of a drag, and the node is never selected.
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await selectNode(page, 'customers.csv');
  await expect(suggestion(page, 'notEmpty:joined')).toBeVisible({ timeout: 20_000 });
  expect(await keys(page)).toEqual(['unique:name', 'notEmpty:id', 'inRange:id', 'noEdgeSpaces:joined', 'notEmpty:joined']);
  await expect(page.getByTestId('rules').getByText('id is unique')).toBeVisible();
});

test('messy.csv suggests only what holds, and every suggestion added passes', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('messy.csv')]);
  await expect(page.getByTestId('inspector-source')).toBeVisible();
  await expect(suggestion(page, 'notEmpty:id')).toBeVisible({ timeout: 20_000 });
  await showMore(page);
  expect(await keys(page)).toEqual(['notEmpty:id', 'readsAs:price', 'inRange:id', 'noEdgeSpaces:price', 'notEmpty:price', 'inRange:joined', 'notEmpty:joined']);
  await expect(suggestion(page, 'inRange:joined')).toContainText('joined runs from 2024-01-31 to 2024-12-25');

  for (let i = 0; i < 7; i++) await suggestions(page).getByRole('button', { name: /^Add suggested rule:/ }).first().click();
  await expect(suggestions(page)).toHaveCount(0);
  const rows = page.getByTestId('rules').locator('.ui-rule');
  await expect(rows).toHaveCount(7);
  for (let i = 0; i < 7; i++) await expect(rows.nth(i)).toHaveAttribute('data-status', 'pass', { timeout: 20_000 });
});

// #290: sixteen suggestions for a six column file, each with its own Add and Dismiss, so none were added.
test('the best five suggestions show first, Show more lists the rest, and Add all adds the five', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('welcome-samples').getByTestId('sample-sales').click();
  await expect(node(page, 'sales.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await selectNode(page, 'sales.csv');
  await expect(suggestion(page, 'unique:order_id')).toBeVisible({ timeout: 20_000 });
  const five = await keys(page);
  expect(five).toHaveLength(5);
  expect(five[0]).toBe('unique:order_id');
  await expect(page.getByTestId('suggestions-count')).toContainText(/^The best 5 of \d+ suggestions$/);

  await showMore(page);
  const all = await keys(page);
  expect(all.length).toBeGreaterThan(5);
  expect(all.slice(0, 5)).toEqual(five);
  // Every amount differs, but an amount is not something to be unique.
  expect(all).not.toContain('unique:amount');
  await suggestions(page).getByRole('button', { name: 'Show fewer' }).click();
  expect(await keys(page)).toEqual(five);

  await suggestions(page).getByRole('button', { name: 'Add all 5 suggested rules' }).click();
  const rules = page.getByTestId('rules').locator('.ui-rule');
  await expect(rules).toHaveCount(5);
  for (let i = 0; i < 5; i++) await expect(rules.nth(i)).toHaveAttribute('data-status', 'pass', { timeout: 20_000 });
  for (const key of five) await expect(suggestion(page, key)).toHaveCount(0);
  // The next best take their place; one Undo takes all five rules back.
  expect(await keys(page)).toEqual(all.slice(5, 10));
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('rules')).toHaveCount(0);
  expect(await keys(page)).toEqual(five);
});
