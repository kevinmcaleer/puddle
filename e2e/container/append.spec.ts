import { expect, test } from '@playwright/test';
import { addFiles, expectRows, fixture, node, openApp, selectNode } from '../helpers/app';

// Parquet needs the self-hosted DuckDB extension, which only the container image serves.
test('appending customers.csv to customers.parquet stacks the same columns', async ({ page, request }) => {
  const manifest = await request.get('/duckdb-extensions/manifest.json');
  test.skip(!manifest.ok() && !process.env.CI, 'This image was built without the DuckDB extensions.');
  await openApp(page);
  await addFiles(page, [fixture('customers.parquet'), fixture('customers.csv')]);
  await expect(node(page, 'customers.parquet')).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  await selectNode(page, 'customers.parquet');
  await selectNode(page, 'customers.csv', ['Shift']);
  await page.getByTestId('group-bar').getByRole('button', { name: 'Append these' }).click();

  await expect(node(page, 'Append 1')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('wire-customers.parquet->Append 1')).toHaveAttribute('data-port', '0');
  await expect(page.getByTestId('inspector-columns').locator('.ui-col')).toHaveText(['id', 'name', 'email', 'joined']);
  await expect(page.getByTestId('append-column-from')).toHaveText(['all inputs', 'all inputs', 'all inputs', 'all inputs']);
  await node(page, 'Append 1').click();
  await expectRows(page, 8);
});
