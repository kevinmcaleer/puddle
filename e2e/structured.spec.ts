import { expect, test } from '@playwright/test';
import { addFiles, columnsOf, expectRows, fixture, node, openApp } from './helpers/app';

test('a YAML file opens to its list of records, the Records picker switches to the whole document, and a GeoJSON file reads its features', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('structured/servers.yaml')]);
  await expect(node(page, 'servers.yaml')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'servers.yaml')).toContainText('Source · YAML');
  expect(await columnsOf(page, 'servers.yaml')).toEqual(['name', 'ip', 'cores', 'tags', 'added', 'owner.team', 'owner.email']);
  await expectRows(page, 3);
  await expect(page.getByLabel('Records').locator('option')).toHaveText(['servers (3 records)', 'The whole document, as one row']);
  await page.getByLabel('Records').selectOption('.');
  await expectRows(page, 1);
  expect(await columnsOf(page, 'servers.yaml')).toEqual(['region', 'servers']);

  await addFiles(page, [fixture('structured/places.geojson')]);
  await expect(node(page, 'places.geojson')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'places.geojson')).toContainText('Source · GeoJSON');
  expect(await columnsOf(page, 'places.geojson')).toEqual(['id', 'name', 'kind', 'height', 'geometry']);
  await expectRows(page, 3);
});
