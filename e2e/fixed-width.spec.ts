import { expect, test } from '@playwright/test';
import { addFiles, columnsOf, expectRows, fixture, openApp } from './helpers/app';

test('a fixed-width file opens with its boundaries found; moving one changes the columns, and Fix all types the balances', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('messy/fixed-width.txt')]);
  // Read as fixed width, the five boundaries found from the columns of spaces, into six named columns.
  expect(await columnsOf(page, 'fixed-width.txt')).toEqual(['CUSTNO', 'NAME', 'CITY', 'BALANCE', 'SINCE', 'ST']);
  await expect(page.getByLabel('Format')).toHaveValue('fixed');
  await expectRows(page, 30);
  const ruler = page.getByTestId('ruler');
  await expect(ruler).toHaveAttribute('data-boundaries', '8,30,43,54,64');
  await expect(page.getByTestId('rewrite-size')).toHaveText('30 rows, 6 columns');

  // A marker removed with the keyboard merges two columns; one nudged right moves the cut.
  await ruler.getByRole('button', { name: 'Boundary at 30' }).focus();
  await page.keyboard.press('Delete');
  await expect(ruler).toHaveAttribute('data-boundaries', '8,43,54,64');
  await expect(page.getByTestId('rewrite-size')).toHaveText('30 rows, 5 columns');
  await ruler.getByRole('button', { name: 'Boundary at 8' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(ruler).toHaveAttribute('data-boundaries', '9,43,54,64');
  // Clicking the lines adds one back between the names and the cities.
  const lines = page.getByTestId('ruler-lines');
  const box = (await lines.boundingBox())!;
  const ch = (await page.getByTestId('ruler').locator('.ui-ruler__probe').boundingBox())!.width / 10;
  await lines.click({ position: { x: 30 * ch, y: box.height / 2 } });
  await expect(ruler).toHaveAttribute('data-boundaries', '9,30,43,54,64');
  await expect(page.getByTestId('rewrite-size')).toHaveText('30 rows, 6 columns');

  // Fix all parses the balances, trailing minus and thousands separators included.
  const issues = page.getByTestId('issues');
  await expect(issues.getByTestId('issue-numbersAsText:BALANCE')).toHaveAttribute('data-severity', 'fix', { timeout: 20_000 });
  await page.getByTestId('inspector-source').getByTestId('fix-all').getByRole('button', { name: /^Fix \d+ (of \d+ )?issues?$/ }).click();
  await expectRows(page, 30);
  await expect(page.getByTestId('issues').getByTestId('issue-numbersAsText:BALANCE')).toHaveCount(0, { timeout: 20_000 });
});
