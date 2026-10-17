import { expect, test, type Page } from '@playwright/test';
import { addFiles, addStep, cell, expectRows, fixture, node } from '../../e2e/helpers/app';
import { annotate, openSample, projectMenu, selectColumnsAt, settings, shot, shotPanel, start, steps } from './helpers';

// Each test captures the pictures for one page of the docs. Pictures are named <page>-<what>.png.

test('getting started', async ({ page }) => {
  await start(page, { tourOffer: true });
  await shot(page, 'start-empty');
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await expect(node(page, 'contacts.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(page.getByRole('dialog', { name: /Sources/ })).toBeVisible();
  await shot(page, 'start-tour');
});

test('samples and the screen', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Try a sample' }).click();
  await shot(page, 'start-samples', page.getByRole('dialog', { name: 'Try a sample' }));
  await page.getByRole('dialog', { name: 'Try a sample' }).getByTestId('sample-contacts').click();
  await expect(node(page, 'contacts.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expectRows(page, 53);
  await shot(page, 'start-sample-open');
  await node(page, 'contacts.csv').click();
  await shot(page, 'screen-overview');
  // The toolbar, canvas, inspector, results and status strip, numbered as the page about the screen lists them.
  await annotate(page, [
    ['header.ui-toolbar', 0.33, 0.5],
    ['[data-testid="canvas"]', 0.5, 0.5],
    ['[data-testid="inspector"]', 0.88, 0.06],
    ['.ui-resultsbar', 0.5, 0.5],
    ['footer.ui-strip', 0.5, 0.5],
  ]);
  await shot(page, 'screen-annotated');
});

test('sources', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await shot(page, 'sources-menu', page.getByRole('menu'));
  await page.keyboard.press('Escape');
  await addFiles(page, [fixture('sales.xlsx')]);
  await page.waitForTimeout(500);
  await shot(page, 'sources-excel');
});

test('quick fixes and steps', async ({ page }) => {
  await start(page);
  await openSample(page, 'contacts');
  await node(page, 'contacts.csv').click();
  // name and city.
  await selectColumnsAt(page, 90, 450);
  await expect(page.getByTestId('quick-fixes')).toHaveAttribute('data-columns', 'name,city');
  await shot(page, 'quickfix-selected');
  const fixes = page.getByRole('toolbar', { name: 'Quick fixes' });
  await shot(page, 'quickfix-bar', fixes);
  await fixes.getByRole('button', { name: 'Trim' }).click();
  await expect(steps(page)).toHaveText([/Trimmed name, city/]);
  await selectColumnsAt(page, 90, 450);
  await fixes.getByRole('button', { name: 'Collapse spaces' }).click();
  await selectColumnsAt(page, 90, 450);
  await fixes.getByRole('button', { name: 'Case' }).click();
  await shot(page, 'quickfix-case-menu', page.getByRole('menu'));
  await page.getByRole('menuitem', { name: 'Title Case' }).click();
  await expect(steps(page)).toHaveCount(3);
  await expect(cell(page, 0, 0)).toHaveText('Alice Patel');
  await shot(page, 'quickfix-applied');

  await page.getByRole('button', { name: 'Add step' }).click();
  await shot(page, 'steps-add-menu', page.getByRole('menu'));
  await page.keyboard.press('Escape');
  await addStep(page, 'Remove duplicates');
  await shotPanel(page, 'steps-settings', page.getByTestId('inspector'));
  await steps(page).nth(0).click();
  await expect(page.getByTestId('results-title')).toHaveText('Transform 1 · step 1');
  await shot(page, 'steps-view-earlier');
});

/** Right-click in the results grid (a canvas) at a point in pixels from its left edge, on the header or on a row. */
async function rightClickAt(page: Page, x: number, row?: number) {
  const box = (await page.getByTestId('results-table').boundingBox())!;
  await page.mouse.click(box.x + x, row == null ? box.y + 20 : box.y + 52 + 28 * row + 14, { button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
}

test('the column menu', async ({ page }) => {
  await start(page);
  await openSample(page, 'contacts');
  await node(page, 'contacts.csv').click();
  const menu = page.getByTestId('context-menu');
  // city.
  await rightClickAt(page, 450);
  await shot(page, 'column-menu', menu);
  await menu.getByRole('menuitem', { name: 'Text' }).hover();
  await expect(menu.getByRole('menu', { name: 'Text' })).toBeVisible();
  await shot(page, 'column-menu-submenu');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // A cell adds a group for its value.
  await rightClickAt(page, 450, 1);
  await shot(page, 'column-menu-cell', menu);
  await page.keyboard.press('Escape');

  await rightClickAt(page, 450);
  await menu.getByRole('menuitem', { name: 'Replace values…' }).click();
  await shot(page, 'column-menu-replace', page.getByRole('dialog', { name: 'Replace values in city' }));
  await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
  await expect(steps(page)).toHaveCount(1);
});

test('groups', async ({ page }) => {
  await start(page);
  await openSample(page, 'contacts');
  await node(page, 'contacts.csv').click();
  await page.keyboard.press('t');
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  await page.keyboard.press('o');
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok');
  await node(page, 'contacts.csv').click();
  await node(page, 'Transform 1').click({ modifiers: ['Shift'] });
  await page.keyboard.press('g');
  await expect(page.getByTestId('group-Group 1')).toBeVisible();
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await shot(page, 'groups-card');
  await page.getByTestId('group-Group 1').dblclick();
  await expect(page.getByTestId('frame-Group 1')).toBeVisible();
  await page.getByRole('button', { name: 'Fit View' }).click();
  await shot(page, 'groups-open');
});

test('rules, outputs and export', async ({ page }) => {
  await start(page);
  await openSample(page, 'contacts');
  await node(page, 'contacts.csv').click();
  const rulesSection = page.locator('section[aria-label="Rules"]');
  await expect(page.getByTestId('rule-suggestions')).toBeVisible({ timeout: 20_000 });
  await shotPanel(page, 'rules-suggestions', rulesSection);

  await page.getByRole('button', { name: 'Add rule' }).click();
  await shot(page, 'rules-add-menu', page.getByRole('menu'));
  await page.getByRole('menuitem', { name: 'Never empty', exact: true }).click();
  await page.getByTestId('rule-settings').getByRole('button', { name: 'email', exact: true }).click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('menuitem', { name: 'No leading or trailing spaces', exact: true }).click();
  await page.getByTestId('rule-settings').getByRole('button', { name: 'name', exact: true }).click();
  await expect(node(page, 'contacts.csv')).toHaveAttribute('data-rules', 'fail', { timeout: 20_000 });
  await page.getByTestId('rules').scrollIntoViewIfNeeded();
  await shot(page, 'rules-failing');

  await page.getByTestId('rules').locator('.ui-rule').first().getByRole('button', { name: 'Show failing rows' }).click();
  await expect(page.getByTestId('results-title')).toContainText('failing');
  await shot(page, 'rules-failing-rows');
  await page.getByRole('button', { name: 'Show all rows' }).click();

  // The column profile in the status strip: select the email column.
  await selectColumnsAt(page, 210);
  await expect(page.getByTestId('column-profile')).toContainText('email');
  await shot(page, 'rules-status-strip', page.locator('footer.ui-strip'), { pad: 0 });

  await node(page, 'contacts.csv').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await shot(page, 'canvas-add-node-menu', page.getByRole('menu'));
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await node(page, 'Output 1').click();
  await expect(node(page, 'Output 1')).toHaveAttribute('data-export', 'blocked');
  await shot(page, 'export-blocked');

  const download = page.waitForEvent('download');
  await page.locator('.ui-resultsbar').getByTestId('export-blocked').getByRole('button', { name: 'Export anyway' }).click();
  await download;
  await expect(page.getByTestId('export-log')).toContainText('Exported anyway past');
  await shotPanel(page, 'export-output-settings', page.getByTestId('output-settings'));

  await page.getByRole('button', { name: 'Export quality report' }).click();
  await shot(page, 'export-report-dialog', page.getByRole('dialog'));
});

test('the export as menu', async ({ page }) => {
  await start(page);
  await openSample(page, 'contacts');
  await node(page, 'contacts.csv').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await node(page, 'Output 1').click();
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  const bar = page.locator('.ui-resultsbar');
  await bar.getByRole('button', { name: 'Export as', exact: true }).click();
  await shot(page, 'export-as-menu', page.getByRole('menu'));
});

/** Two files on the canvas, selected in order (click, then Shift+click), and the Add menu item applied to them. */
async function combine(page: Page, files: string[], item: RegExp, made: string) {
  await addFiles(page, files.map(fixture));
  for (const f of files) await expect(node(page, f)).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, files[0]!).click();
  for (const f of files.slice(1)) await node(page, f).click({ modifiers: ['Shift'] });
  if (made === 'selection') return;
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
  if (made !== 'designer') await expect(node(page, made)).toHaveAttribute('data-status', 'ok');
}

test('combining data', async ({ page }) => {
  await start(page);
  await combine(page, ['shop-orders.csv', 'shop-customers.csv'], /Join/, 'selection');
  await expect(page.getByTestId('group-bar')).toBeVisible();
  await shot(page, 'combine-selection-bar', page.getByTestId('group-bar'));
  await page.getByTestId('group-bar').getByRole('button', { name: 'Join these two' }).click();
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'ok');
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await node(page, 'Join 1').click();
  await expectRows(page, 6);
  await shot(page, 'combine-join');
  await shotPanel(page, 'combine-join-settings', page.getByTestId('inspector-join'));
});

test('appending and looking up', async ({ page }) => {
  await start(page);
  await combine(page, ['customers.csv', 'customers-more.csv'], /Append/, 'Append 1');
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await node(page, 'Append 1').click();
  await expectRows(page, 6);
  await shot(page, 'combine-append');

  await projectMenu(page, 'All projects');
  await page.getByRole('button', { name: 'New project' }).click();
  await combine(page, ['shop-orders.csv', 'shop-customers.csv'], /Lookup/, 'Lookup 1');
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await node(page, 'Lookup 1').click();
  await expectRows(page, 5);
  await shotPanel(page, 'combine-lookup-settings', page.getByTestId('inspector-lookup'));
});

test('query designer', async ({ page }) => {
  await start(page);
  await combine(page, ['shop-customers.csv', 'shop-orders.csv'], /Query/, 'designer');
  const designer = page.getByTestId('query-designer');
  await expect(designer).toBeVisible();
  const field = (table: number, column: string) => page.getByTestId(`query-field-${table}-${column}`);
  await field(1, 'customer_id').dragTo(field(2, 'customer_id'));
  await expect(designer.getByTestId('query-join-line')).toHaveCount(1);
  await field(2, 'order_id').dblclick();
  await field(1, 'name').dblclick();
  await field(2, 'total').dblclick();
  await page.getByLabel('Sort order_id').selectOption({ label: 'Ascending' });
  await page.getByLabel('Criteria for total').selectOption({ label: 'More than' });
  await page.getByLabel('Criteria value for total').fill('5');
  await page.getByLabel('Criteria value for total').press('Enter');
  await expect(page.getByTestId('results-title')).toHaveText('Query 1');
  await shot(page, 'query-designer');
});

test('reshaping', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await start(page);
  await openSample(page, 'monthly');
  await node(page, 'monthly-sales.csv').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await node(page, 'Transform 1').click();
  await addStep(page, 'Unpivot columns');
  for (const m of ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']) {
    await settings(page).getByRole('button', { name: `${m}_2024`, exact: true }).click();
  }
  await settings(page).getByLabel('Attribute column', { exact: true }).fill('month');
  await settings(page).getByLabel('Attribute column', { exact: true }).press('Enter');
  await expect(steps(page)).toHaveText([/Unpivoted/]);
  await shot(page, 'reshape-unpivot');

  await projectMenu(page, 'All projects');
  await page.getByRole('button', { name: 'New project' }).click();
  await addFiles(page, [fixture('sales.csv')]);
  await expect(node(page, 'sales.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, 'sales.csv').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await node(page, 'Transform 1').click();
  await addStep(page, 'Pivot or group by');
  const editor = page.getByTestId('pivot-editor');
  for (const [field, zone] of [['region', 'Rows'], ['month', 'Columns'], ['revenue', 'Values']] as const) {
    await editor.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await editor.getByRole('button', { name: `Add ${field}` }).dragTo(editor.getByRole('group', { name: zone, exact: true }));
    await expect(editor.getByRole('group', { name: zone, exact: true }).getByRole('button', { name: `${zone}: ${field}` })).toBeVisible();
  }
  await expect(cell(page, 0, 0)).not.toHaveText('', { timeout: 20_000 });
  await shot(page, 'reshape-pivot');
  await shotPanel(page, 'reshape-pivot-editor', editor);
});

test('projects, templates and recipes', async ({ page }) => {
  await start(page);
  await openSample(page, 'contacts');
  await page.getByTestId('project-menu').click();
  await shot(page, 'projects-menu', page.getByRole('menu'));
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Write' }).click();
  await shot(page, 'projects-notes');

  await node(page, 'contacts.csv').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await node(page, 'Transform 1').click();
  await addStep(page, 'Trim whitespace');
  await addStep(page, 'Change case');
  await page.getByRole('button', { name: 'Save as template' }).click();
  const save = page.getByRole('dialog', { name: 'Save as template' });
  await save.getByLabel('Name', { exact: true }).fill('Tidy names');
  await save.getByLabel('Description').fill('Trims and title-cases names.');
  await shot(page, 'templates-save', save);
  await save.getByRole('button', { name: 'Save template' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /From template/ }).click();
  const library = page.getByRole('dialog', { name: 'Templates' });
  await library.getByRole('listbox', { name: 'Templates library' }).getByRole('option', { name: 'Tidy names' }).click();
  await shot(page, 'templates-library', library);
  await page.keyboard.press('Escape');

  await projectMenu(page, 'All projects');
  await expect(page.getByTestId('home')).toBeVisible();
  await shot(page, 'projects-home');
  await page.getByTestId('recipe-gallery').scrollIntoViewIfNeeded();
  await shot(page, 'recipes-gallery', page.getByTestId('recipe-gallery'));
  await page.getByTestId('recipe-gallery').getByRole('listitem', { name: 'Tidy a contact list' }).getByRole('button', { name: 'Use recipe' }).click();
  await expect(page.getByTestId('recipe-attach')).toBeVisible();
  const reconnect = page.getByRole('status').filter({ hasText: 'Files aren’t kept in this browser' });
  if (await reconnect.isVisible()) await reconnect.getByRole('button', { name: 'Dismiss' }).click();
  await shot(page, 'recipes-attach');
});

test('sync, settings and help', async ({ page }) => {
  await start(page);
  await openSample(page, 'sales');
  await projectMenu(page, 'Sync to GitHub Gist');
  await shot(page, 'sync-gist', page.getByRole('dialog', { name: 'Sync to GitHub Gist' }));
  await page.keyboard.press('Escape');

  // The inspector's Project tab holds the project's settings.
  await page.getByRole('tab', { name: 'Project' }).click();
  await shotPanel(page, 'settings-project', page.getByTestId('inspector'), { height: 1200 });

  await page.getByTestId('help-menu').click();
  await shot(page, 'settings-help-menu', page.getByRole('menu'));
  await page.keyboard.press('Escape');
  await page.getByTestId('help-menu').click();
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
  await shot(page, 'settings-shortcuts', page.getByRole('dialog'));
  await page.keyboard.press('Escape');

  await node(page, 'sales.csv').click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'settings-dark');
});
