import { expect, test, type Download, type Page } from '@playwright/test';
import { addFiles, fixture, node, openApp } from './helpers/app';

const dialog = (page: Page) => page.getByTestId('report-dialog');
const textOf = async (file: Download) => Buffer.concat(await (await file.createReadStream()).toArray()).toString('utf8');

/** customers.csv into an Output node, with a failing fail rule on the source exported past once. */
async function overriddenExport(page: Page) {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok');

  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('menuitem', { name: 'No leading or trailing spaces', exact: true }).click();
  await page.getByTestId('rule-settings').getByRole('button', { name: 'name', exact: true }).click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('menuitem', { name: 'Unique', exact: true }).click();
  // It checks the first column, id, to begin with.
  await expect(page.getByTestId('rule-unique')).toContainText('id is unique');
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-rules', 'fail', { timeout: 20_000 });

  await node(page, 'Output 1').click();
  const download = page.waitForEvent('download');
  await page.locator('.ui-resultsbar').getByTestId('export-blocked').getByRole('button', { name: 'Export anyway' }).click();
  await download;
  await expect(page.getByTestId('export-log')).toContainText('Exported anyway past');
}

async function exportReport(page: Page, { format, scope, rows }: { format: 'markdown' | 'json' | 'html'; scope?: 'all'; rows?: number }) {
  await page.getByRole('button', { name: 'Export quality report' }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByLabel('Format').selectOption(format);
  if (scope) await dialog(page).getByLabel('Rules from').selectOption(scope);
  if (rows != null) {
    await dialog(page).getByRole('switch', { name: 'Include sample failing rows' }).click();
    await expect(dialog(page).getByLabel('Failing rows per rule')).toHaveValue('10');
    await dialog(page).getByLabel('Failing rows per rule').fill(String(rows));
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export report' }).click();
  const file = await download;
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByTestId('canvas-notice')).toContainText(`Exported ${file.suggestedFilename()}.`);
  return file;
}

test('an Output node exports a Markdown quality report with the rules panel’s counts, the override, and no row values', async ({ page }) => {
  await overriddenExport(page);
  // The rules panel's figures, to match against.
  await node(page, 'customers.csv').click();
  await expect(page.getByTestId('rule-noEdgeSpaces')).toContainText('2 of 4');
  await node(page, 'Output 1').click();

  const file = await exportReport(page, { format: 'markdown' });
  expect(file.suggestedFilename()).toMatch(/ quality report\.md$/);
  const md = await textOf(file);
  expect(md).toContain('| Overridden | No leading or trailing spaces in name | No leading or trailing spaces | Fail | name | 4 | 2 | 2 | 50% |');
  expect(md).toContain('| Pass | id is unique | Unique | Fail | id | 4 | 4 | 0 | 0% |');
  expect(md).toMatch(/overridden\. Exported anyway on .+ UTC, from Output 1 to Output 1\.csv\./);
  expect(md).toMatch(/\| customers\.csv \| csv \| 4 \| `[0-9a-f]{64}` \|/);
  expect(md).toContain('This report contains no row values');
  for (const value of ['Ada Lovelace', 'grace hopper', 'example.com', '2024-01-31']) expect(md).not.toContain(value);
});

test('the rules panel exports an HTML report with sample failing rows, and JSON for every node with rules', async ({ page }) => {
  await overriddenExport(page);
  await node(page, 'customers.csv').click();

  const html = await textOf(await exportReport(page, { format: 'html', rows: 1 }));
  expect(html.startsWith('<!doctype html>')).toBe(true);
  expect(html).toContain('data-status="overridden"');
  expect(html).toContain('sample failing rows, which contain data');
  expect(html).toContain('Ada Lovelace');
  // One row per rule asked for: the second failing row (id 4) is left out.
  expect(html).toContain('(first 1 of 2)');

  const json = JSON.parse(await textOf(await exportReport(page, { format: 'json', scope: 'all' })));
  expect(json.schema).toBe('puddle-quality-report/1');
  expect(json.sampleLimit).toBe(0);
  expect(json.nodes.map((n: { name: string }) => n.name)).toEqual(['customers.csv']);
  expect(json.nodes[0].rules.map((r: { label: string; status: string; failed: number; total: number }) => [r.label, r.status, r.failed, r.total])).toEqual([
    ['No leading or trailing spaces in name', 'overridden', 2, 4],
    ['id is unique', 'pass', 0, 4],
  ]);
  expect(json.nodes[0].rules[0].override).toMatchObject({ outputName: 'Output 1', fileName: 'Output 1.csv' });
  expect(json.sources).toEqual([expect.objectContaining({ name: 'customers.csv', rows: 4, headHash: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
});
