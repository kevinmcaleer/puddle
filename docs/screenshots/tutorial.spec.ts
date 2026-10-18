import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { addFiles, addStep, bringIntoView, cell, node } from '../../e2e/helpers/app';
import { selectColumnsAt, settings, shot, shotPanel, start, steps } from './helpers';

// The pictures for the New York taxi tutorial (tutorial-taxi.md), taken on the real TLC files: January 2024's yellow
// cab trips and the taxi zone lookup. They are too big to keep in the repository, so `npm run docs:tutorial-data`
// downloads them into docs/_data first. Without them this test is skipped on your machine and fails in CI.

const DATA = process.env.TUTORIAL_DATA ?? join(import.meta.dirname, '../_data');
const TRIPS = 'yellow_tripdata_2024-01.parquet';
const ZONES = 'taxi_zone_lookup.csv';
const have = existsSync(join(DATA, TRIPS)) && existsSync(join(DATA, ZONES));

// Three million rows take a while to read, check and summarise in one browser thread.
const SLOW = { timeout: 120_000 };

const rules = (page: Page) => page.getByTestId('rules');
const ruleSettings = (page: Page) => page.getByTestId('rule-settings');

/** Wait until the results table has counted its rows: more than a million of them. */
const counted = (page: Page) => expect(page.getByTestId('results-table')).toHaveAttribute('data-rows', /^\d{7,}$/, SLOW);

/**
 * Select a column by its header. The grid is a canvas and its column widths follow the data, so the header is found
 * by clicking along the header row until the grid says it is the one selected.
 */
async function selectColumn(page: Page, name: string) {
  const table = page.getByTestId('results-table');
  const width = (await table.boundingBox())!.width;
  for (let x = 60; x < width; x += 40) {
    await selectColumnsAt(page, x);
    if ((await table.getAttribute('data-selected')) === name) return expect(page.getByTestId('column-profile')).toContainText(`${name} ·`, SLOW);
  }
  throw new Error(`There's no ${name} column in view.`);
}

/**
 * Wait until DuckDB has finished what it's doing, so the status strip doesn't show a query running. The strip only
 * shows a query after it has run for a second, so give one that has just started the chance to show first.
 */
async function quiet(page: Page) {
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('activity')).toHaveCount(0, SLOW);
}

async function addRule(page: Page, title: string) {
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('menuitem', { name: title, exact: true }).click();
}

/**
 * Add a node (or a step, which makes a Transform of its own) after the selected one from the Add menu, and select it.
 * A step that needs a column before it can run (a pivot with nothing in Rows or Values) starts in `error`.
 */
async function addNode(page: Page, item: string | RegExp, made: string, status: 'ok' | 'error' = 'ok') {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
  await bringIntoView(page, made);
  await expect(node(page, made)).toHaveAttribute('data-status', status, SLOW);
  await node(page, made).click();
}

test('tutorial: New York taxi trips', async ({ page }) => {
  test.skip(!have && !process.env.CI, `Run npm run docs:tutorial-data first: ${TRIPS} and ${ZONES} aren't in ${DATA}.`);
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await start(page);

  // The two files, side by side on the canvas.
  await addFiles(page, [join(DATA, TRIPS), join(DATA, ZONES)]);
  for (const f of [TRIPS, ZONES]) await expect(node(page, f)).toHaveAttribute('data-status', 'ok', SLOW);
  await node(page, TRIPS).click();
  await counted(page);
  await quiet(page);
  await shot(page, 'tutorial-sources');

  // passenger_count: the status strip profiles it.
  await selectColumn(page, 'passenger_count');
  await quiet(page);
  await shot(page, 'tutorial-profile', page.locator('footer.ui-strip'), { pad: 0 });
  await page.keyboard.press('Escape');

  // What the raw file breaks, each as a warning: it's the cleaned data that has to be right.
  await node(page, TRIPS).click();
  await addRule(page, 'In a range');
  await ruleSettings(page).getByRole('button', { name: 'fare_amount', exact: true }).click();
  await ruleSettings(page).getByLabel('Lowest').fill('0');
  await ruleSettings(page).getByLabel('Lowest').press('Enter');
  await ruleSettings(page).getByLabel('Severity').selectOption('warn');
  await addRule(page, 'Never empty');
  await ruleSettings(page).getByRole('button', { name: 'passenger_count', exact: true }).click();
  await ruleSettings(page).getByLabel('Severity').selectOption('warn');
  await addRule(page, 'Custom expression');
  const expr = ruleSettings(page).getByRole('combobox', { name: 'Every row satisfies' });
  await expr.fill('tpep_dropoff_datetime > tpep_pickup_datetime');
  await expr.blur();
  await ruleSettings(page).getByLabel('Severity').selectOption('warn');
  const rows = rules(page).locator('.ui-rule');
  await expect(rows).toHaveCount(3);
  for (const r of await rows.all()) await expect(r).toHaveAttribute('data-status', 'warn', SLOW);
  await expect(node(page, TRIPS)).toContainText('3 warnings', SLOW);
  await rules(page).scrollIntoViewIfNeeded();
  await quiet(page);
  await shot(page, 'tutorial-rules');

  await rows.nth(2).getByRole('button', { name: 'Show failing rows' }).click();
  await expect(page.getByTestId('results-title')).toContainText('failing', SLOW);
  await expect(cell(page, 0, 0)).not.toHaveText('', SLOW);
  await quiet(page);
  await shot(page, 'tutorial-failing-rows');
  await page.getByRole('button', { name: 'Show all rows' }).click();

  // Clean: how long each trip took, the hour it started, and only the trips that make sense.
  await node(page, TRIPS).click();
  await addNode(page, /^Time between dates/, 'Transform 1');
  await settings(page).getByLabel('In', { exact: true }).selectOption('minutes');
  await settings(page).getByLabel('New column').fill('trip_minutes');
  await settings(page).getByLabel('New column').press('Enter');
  await expect(steps(page)).toHaveText([/trip_minutes/]);

  await addStep(page, 'Extract date part');
  const pickup = settings(page).getByRole('button', { name: 'tpep_pickup_datetime', exact: true });
  const dropoff = settings(page).getByRole('button', { name: 'tpep_dropoff_datetime', exact: true });
  if ((await pickup.getAttribute('aria-pressed')) !== 'true') await pickup.click();
  if ((await dropoff.getAttribute('aria-pressed')) === 'true') await dropoff.click();
  await settings(page).getByLabel('Part', { exact: true }).selectOption('hour');
  await expect(steps(page).nth(1)).toHaveText(/Extracted hour from tpep_pickup_datetime$/);

  await addStep(page, 'Filter rows');
  const conditions = [
    ['tpep_pickup_datetime', 'greaterOrEqual', '2024-01-01'],
    ['tpep_pickup_datetime', 'less', '2024-02-01'],
    ['trip_minutes', 'greater', '0'],
    ['trip_distance', 'greater', '0'],
    ['passenger_count', 'greaterOrEqual', '1'],
    ['fare_amount', 'greaterOrEqual', '0'],
  ] as const;
  for (const [i, [column, op, value]] of conditions.entries()) {
    if (i) await settings(page).getByRole('button', { name: 'Add condition' }).click();
    await settings(page).getByLabel(`Condition ${i + 1} column`, { exact: true }).selectOption(column);
    await settings(page).getByLabel(`Condition ${i + 1} comparison`).selectOption(op);
    await settings(page).getByLabel(`Condition ${i + 1} value`).fill(value);
    await settings(page).getByLabel(`Condition ${i + 1} value`).press('Enter');
  }
  await expect(steps(page).nth(2)).toHaveText(/Kept rows matching all of 6 conditions/);
  await counted(page);
  await quiet(page);
  await shot(page, 'tutorial-clean');
  await shotPanel(page, 'tutorial-filter', settings(page));

  // Look up the borough and zone each trip started in.
  await node(page, 'Transform 1').click();
  await node(page, ZONES).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /Lookup/ }).click();
  await expect(node(page, 'Lookup 1')).toHaveAttribute('data-status', /ok|error/, SLOW);
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await bringIntoView(page, 'Lookup 1');
  await node(page, 'Lookup 1').click();
  const lookup = page.getByTestId('inspector-lookup');
  if (!(await lookup.getByLabel('Main column 1').isVisible())) await lookup.getByRole('button', { name: 'Add key pair' }).click();
  await lookup.getByLabel('Main column 1').selectOption('PULocationID');
  await lookup.getByLabel('Lookup column 1').selectOption('LocationID');
  for (const c of ['Borough', 'Zone']) {
    if (!(await lookup.getByTestId('lookup-columns').getByText(c, { exact: true }).isVisible())) await lookup.getByLabel('Add a column to bring across').selectOption(c);
  }
  await expect(node(page, 'Lookup 1')).toHaveAttribute('data-status', 'ok', SLOW);
  await expect(lookup.getByTestId('lookup-match')).toContainText('rows matched', SLOW);
  // Everything after it reads its result rather than running the lookup again.
  await page.getByRole('switch', { name: 'Keep result in memory' }).click();
  await expect(page.getByTestId('keep-memory')).toHaveAttribute('data-state', 'ready', SLOW);
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-columns', /,Borough,Zone$/, SLOW);
  await shotPanel(page, 'tutorial-lookup', lookup);

  // Summarise: the average fare by the hour a trip started, a column per borough.
  await addNode(page, /^Pivot or group by/, 'Transform 2', 'error');
  await page.setViewportSize({ width: 1440, height: 1200 });
  const editor = page.getByTestId('pivot-editor');
  const zone = (name: string) => editor.getByRole('group', { name, exact: true });
  for (const [field, to] of [['tpep_pickup_datetime_hour', 'Rows'], ['Borough', 'Columns'], ['fare_amount', 'Values']] as const) {
    await editor.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await editor.getByRole('button', { name: `Add ${field}` }).dragTo(zone(to));
    await expect(zone(to).getByRole('button', { name: `${to}: ${field}` })).toBeVisible();
  }
  await zone('Values').getByRole('button', { name: 'Summarise fare_amount: sum' }).click();
  await editor.getByRole('menuitem', { name: 'Average', exact: true }).click();
  await expect(zone('Values').getByRole('button', { name: 'Summarise fare_amount: average' })).toBeVisible();
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-rows', '24', SLOW);
  await addStep(page, 'Round');
  // The averages, a column per borough, and not the hours: they are whole numbers already.
  for (const average of await settings(page).getByRole('button', { name: /average of fare_amount$/ }).all()) {
    if ((await average.getAttribute('aria-pressed')) !== 'true') await average.click();
  }
  const hours = settings(page).getByRole('button', { name: 'tpep_pickup_datetime_hour', exact: true });
  if ((await hours.getAttribute('aria-pressed')) === 'true') await hours.click();
  await settings(page).getByLabel('Decimal places').fill('2');
  await settings(page).getByLabel('Decimal places').press('Enter');
  await expect(steps(page).nth(1)).toHaveText(/Rounded/);
  await expect(cell(page, 1, 0)).toHaveText(/^\d+(\.\d{1,2})?$/, SLOW);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await quiet(page);
  await shot(page, 'tutorial-pivot');

  // Save the cleaned trips, with their zones, as Parquet.
  await node(page, 'Lookup 1').click();
  await addNode(page, 'Output', 'Output 1');
  await page.getByTestId('output-settings').getByLabel('Format').selectOption('parquet');
  await page.getByTestId('output-settings').getByLabel('File name').fill('taxi-trips-2024-01-clean');
  await page.getByTestId('output-settings').getByLabel('File name').press('Enter');
  await expect(page.getByTestId('output-settings')).toContainText('Saved as taxi-trips-2024-01-clean.parquet.');
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await page.getByRole('button', { name: 'Fit View' }).click();
  await expect(cell(page, 0, 0)).not.toHaveText('', SLOW);
  await quiet(page);
  await shot(page, 'tutorial-export');
});
