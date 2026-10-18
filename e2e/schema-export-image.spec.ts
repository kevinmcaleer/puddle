import { expect, test } from '@playwright/test';
import { openApp } from './helpers/app';

const DBML = `Table customers {
  id integer [pk]
  email varchar
  note text
}

Table orders {
  id integer [pk]
  customer_id integer [ref: > customers.id]
}
`;

const read = async (download: import('@playwright/test').Download) => Buffer.concat(await (await download.createReadStream()).toArray());

test('exporting the diagram: an SVG that names the tables, a PNG at twice the size, and Mermaid', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
  await page.getByRole('combobox', { name: 'DBML' }).fill(DBML);
  await expect(page.getByTestId('schema-table-orders')).toBeVisible();
  // At Keys the picture leaves the other columns out, as the screen does.
  await page.getByTestId('schema-views').getByRole('button', { name: 'Keys' }).click();

  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /Image/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Export as image' });
  let download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /^Download .*\.svg$/ }).click();
  const svg = (await read(await download)).toString('utf8');
  expect(svg).toContain('<svg');
  expect(svg).toContain('>customers</text>');
  expect(svg).toContain('>orders</text>');
  expect(svg).toContain('>customer_id</text>');
  expect(svg).not.toContain('>note</text>');
  expect(svg).not.toContain('class=');
  const [w, h] = [Number(/width="(\d+)"/.exec(svg)![1]), Number(/height="(\d+)"/.exec(svg)![1])];

  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /Image/ }).click();
  await dialog.getByLabel('Format').selectOption('png');
  await dialog.getByLabel('Size').selectOption('2');
  download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /^Download .*\.png$/ }).click();
  const png = await read(await download);
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  // A PNG keeps its width and height at bytes 16 to 24.
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([w * 2, h * 2]);

  // A PDF: one page the size of the picture.
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /Image/ }).click();
  await dialog.getByLabel('Format').selectOption('pdf');
  download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /^Download .*\.pdf$/ }).click();
  const pdf = (await read(await download)).toString('latin1');
  expect(pdf.startsWith('%PDF-1.4')).toBe(true);
  expect(pdf).toContain(`/MediaBox [0 0 ${w} ${h}]`);

  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /Mermaid/ }).click();
  const mermaid = page.getByRole('dialog', { name: 'Export as Mermaid' }).getByTestId('export-mermaid-preview');
  await expect(mermaid).toContainText('orders }o--|| customers : "customer_id"');
  await expect(mermaid).not.toContainText('note');
});
