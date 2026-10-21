import { expect, test, type Page } from '@playwright/test';
import { addFiles, addStep, addStepNode, addStepWithT, cell, expectRows, fixture, fixtureText, node, selectNode } from '../../e2e/helpers/app';
import { annotate, openSample, projectMenu, selectColumnsAt, settings, shot, shotClip, shotPanel, start, steps } from './helpers';

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
  await selectNode(page, 'contacts.csv');
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
  // From web page, with Wikipedia's API answered from the fixture.
  await page.route(/^https:\/\/en\.wikipedia\.org\/w\/api\.php\?/, (route) =>
    route.fulfill({ json: { parse: { text: fixtureText('bond-films.html') } }, headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  await page.getByRole('menuitem', { name: /From web page/ }).click();
  const web = page.getByRole('dialog', { name: 'Add source from a web page' });
  await web.getByLabel('Address').fill('https://en.wikipedia.org/wiki/List_of_James_Bond_films');
  await web.getByRole('button', { name: 'Find tables' }).click();
  await expect(web.getByTestId('web-table-preview')).toContainText('Dr. No');
  await shot(page, 'sources-web-page', web);
  await web.getByRole('button', { name: 'Cancel' }).click();
  // From OData feed, with TripPin answered from the fixture.
  await page.route('https://services.odata.org/TripPinRESTierService/$metadata', (route) =>
    route.fulfill({ body: fixtureText('odata/trippin-metadata.xml'), contentType: 'application/xml', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /From OData feed/ }).click();
  const odata = page.getByRole('dialog', { name: 'Add source from an OData feed' });
  await odata.getByLabel('Address').fill('https://services.odata.org/TripPinRESTierService');
  await odata.getByRole('button', { name: 'Connect' }).click();
  await expect(odata.getByLabel(/^Entity set/)).toHaveValue('People');
  await shot(page, 'sources-odata', odata);
  await odata.getByRole('button', { name: 'Cancel' }).click();
  await addFiles(page, [fixture('sales.xlsx')]);
  await page.waitForTimeout(500);
  await shot(page, 'sources-excel');
  // An Access database: its table picker, and the button that adds its other tables.
  await addFiles(page, [fixture('shop.accdb')]);
  await expect(page.getByTestId('node-shop.accdb')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(page.getByTestId('access-add-tables')).toBeVisible();
  await shot(page, 'sources-access');
});

/** Each fix opens a new node, whose table may still be loading: click name and city until they are the selection. */
async function reselect(page: Page) {
  await expect(async () => {
    await selectColumnsAt(page, 90, 450);
    await expect(page.getByTestId('quick-fixes')).toHaveAttribute('data-columns', 'name,city', { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test('quick fixes and steps', async ({ page }) => {
  await start(page);
  await openSample(page, 'contacts');
  await selectNode(page, 'contacts.csv');
  // name and city.
  await selectColumnsAt(page, 90, 450);
  await expect(page.getByTestId('quick-fixes')).toHaveAttribute('data-columns', 'name,city');
  await shot(page, 'quickfix-selected');
  const fixes = page.getByRole('toolbar', { name: 'Quick fixes' });
  await shot(page, 'quickfix-bar', fixes);
  await fixes.getByRole('button', { name: 'Trim' }).click();
  await expect(steps(page)).toHaveText([/Trimmed name, city/]);
  await reselect(page);
  await fixes.getByRole('button', { name: 'Collapse spaces' }).click();
  await reselect(page);
  await fixes.getByRole('button', { name: 'Case' }).click();
  await shot(page, 'quickfix-case-menu', page.getByRole('menu'));
  await page.getByRole('menuitem', { name: 'Title Case' }).click();
  // Each fix is a Transform of its own, wired after the one before.
  await expect(node(page, 'Transform 3')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(steps(page)).toHaveCount(1);
  await expect(cell(page, 0, 0)).toHaveText('Alice Patel', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await shot(page, 'quickfix-applied');

  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await shot(page, 'steps-add-menu', page.getByRole('menu'));
  await page.keyboard.press('Escape');
  // Add step in the inspector adds to the node being looked at.
  await addStep(page, 'Remove duplicates');
  await shotPanel(page, 'steps-settings', page.getByTestId('inspector'));
  await steps(page).nth(0).click();
  await expect(page.getByTestId('results-title')).toHaveText('Transform 3 · step 1');
  await shot(page, 'steps-view-earlier');
});

/** Right-click in the results grid (a canvas) at a point in pixels from its left edge, on the header or on a row. */
async function rightClickAt(page: Page, x: number, row?: number) {
  // The grid draws once its rows arrive: a right-click before then opens nothing, so one that didn't is tried again.
  await expect(async () => {
    const box = (await page.getByTestId('results-table').boundingBox())!;
    await page.mouse.click(box.x + x, row == null ? box.y + 20 : box.y + 52 + 28 * row + 14, { button: 'right' });
    await expect(page.getByTestId('context-menu')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test('the column menu', async ({ page }) => {
  await start(page);
  await openSample(page, 'contacts');
  await selectNode(page, 'contacts.csv');
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
  await selectNode(page, 'contacts.csv');
  await addStepWithT(page, 'Trim whitespace');
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  await page.keyboard.press('o');
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok');
  await selectNode(page, 'contacts.csv');
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
  await selectNode(page, 'contacts.csv');
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

  await selectNode(page, 'contacts.csv');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await shot(page, 'canvas-add-node-menu', page.getByRole('menu'));
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await selectNode(page, 'Output 1');
  await expect(node(page, 'Output 1')).toHaveAttribute('data-export', 'blocked');
  await shot(page, 'export-blocked');

  const download = page.waitForEvent('download');
  await page.locator('.ui-resultsbar').getByTestId('export-blocked').getByRole('button', { name: 'Export anyway' }).click();
  await download;
  await expect(page.getByTestId('export-log')).toContainText('Exported anyway past');
  await shotPanel(page, 'export-output-settings', page.getByTestId('output-settings'));

  await page.getByRole('button', { name: 'Write quality report' }).click();
  await shot(page, 'export-report-dialog', page.getByRole('dialog'));
});

test('the export as menu', async ({ page }) => {
  await start(page);
  await openSample(page, 'contacts');
  await selectNode(page, 'contacts.csv');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Output' }).click();
  await selectNode(page, 'Output 1');
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  const bar = page.locator('.ui-resultsbar');
  await bar.getByRole('button', { name: 'Export as', exact: true }).click();
  await shot(page, 'export-as-menu', page.getByRole('menu'));
});

/** Two files on the canvas, selected in order (click, then Shift+click), and the Add menu item applied to them. */
async function combine(page: Page, files: string[], item: RegExp, made: string) {
  await addFiles(page, files.map(fixture));
  for (const f of files) await expect(node(page, f)).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await selectNode(page, files[0]!);
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
  await selectNode(page, 'Join 1');
  await expectRows(page, 6);
  await shot(page, 'combine-join');
  await shotPanel(page, 'combine-join-settings', page.getByTestId('inspector-join'));
});

test('appending and looking up', async ({ page }) => {
  await start(page);
  await combine(page, ['customers.csv', 'customers-more.csv'], /Append/, 'Append 1');
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await selectNode(page, 'Append 1');
  await expectRows(page, 6);
  await shot(page, 'combine-append');

  await projectMenu(page, 'All projects');
  await page.getByRole('button', { name: 'New project' }).click();
  await combine(page, ['shop-orders.csv', 'shop-customers.csv'], /Lookup/, 'Lookup 1');
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await selectNode(page, 'Lookup 1');
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
  // Filling in the criteria scrolled the designer down; the shot starts at its bar.
  await designer.evaluate((el) => el.scrollTo(0, 0));
  await shot(page, 'query-designer');
  await designer.getByRole('tab', { name: 'SQL' }).click();
  await expect(designer.getByLabel('SQL', { exact: true })).toHaveValue(/WHERE "shop-orders.csv".total > 5/);
  await shot(page, 'query-sql-view');
});

test('relationships', async ({ page }) => {
  await start(page);
  await combine(page, ['shop-orders.csv', 'shop-customers.csv'], /Join/, 'selection');
  await page.getByTestId('group-bar').getByRole('button', { name: 'Join these two' }).click();
  await expect(node(page, 'Join 1')).toHaveAttribute('data-status', 'ok');
  await projectMenu(page, 'Relationships');
  const view = page.getByTestId('relationships');
  await view.getByTestId('rel-field-shop-orders.csv-status').dragTo(view.getByTestId('rel-field-shop-customers.csv-status'));
  await expect(view.getByTestId('relationship-cardinality')).toHaveText(['many to many', 'many to many']);
  await shot(page, 'relationships');
  // The Schema view documents the same tables, the Join as a query, and the relationships between them.
  await projectMenu(page, 'Schema');
  await expect(page.getByTestId('schema-canvas-counts')).toHaveText('3 from the canvas');
  await page.getByRole('button', { name: 'Hide inspector' }).click();
  await page.getByRole('button', { name: 'Hide results' }).click();
  await page.getByRole('button', { name: 'Auto-arrange' }).click();
  await shot(page, 'schema-canvas');
});

test('reshaping', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await start(page);
  await openSample(page, 'monthly');
  await selectNode(page, 'monthly-sales.csv');
  await addStepNode(page, 'Unpivot columns');
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
  await selectNode(page, 'sales.csv');
  await addStepNode(page, 'Pivot or group by');
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

  await selectNode(page, 'contacts.csv');
  await addStepNode(page, 'Trim whitespace');
  await addStepNode(page, 'Change case', 'Transform 2');
  await node(page, 'Transform 1').click({ button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Group the chain' }).click();
  await expect(page.getByTestId('group-Group 1')).toBeVisible();
  await page.getByTestId('group-Group 1').click({ button: 'right' });
  await shot(page, 'groups-menu', page.getByTestId('context-menu'));
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Save as template…' }).click();
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
  const reconnect = page.getByRole('status').filter({ hasText: 'Files from last time' });
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

  await selectNode(page, 'sales.csv');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'settings-dark');
});

/** Open the Schema view with the shop's DBML written in, laid out by Auto-arrange. */
async function openShopSchema(page: Page) {
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
  await page.getByRole('combobox', { name: 'DBML' }).fill(fixtureText('dbml/shop.dbml'));
  await expect(page.getByTestId('schema-table-order_items')).toBeVisible();
  // The whole window for the editor and the diagram.
  await page.getByRole('button', { name: 'Hide inspector' }).click();
  await page.getByRole('button', { name: 'Hide results' }).click();
  await page.getByRole('button', { name: 'Auto-arrange' }).click();
}

test('schema view and editing', async ({ page }) => {
  await start(page);
  await openShopSchema(page);
  await shot(page, 'schema-view');
  // Hovering a column shows its settings.
  await page.getByTestId('schema-col-orders-status').hover();
  await expect(page.getByTestId('schema-popover')).toBeVisible();
  await shot(page, 'schema-column-popover', page.getByTestId('schema-popover'));
  await page.mouse.move(5, 5);
  // A column's menu.
  await page.getByTestId('schema-col-orders-total').click({ button: 'right' });
  await shot(page, 'schema-column-menu', page.getByRole('menu'));
  await page.keyboard.press('Escape');
  // A view of two tables at the Keys detail level.
  await page.getByTestId('schema-table-orders').locator('.puddle-schema-table__head').click({ modifiers: ['Shift'] });
  await page.getByTestId('schema-table-customers').locator('.puddle-schema-table__head').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'New view of 2' }).click();
  await page.getByTestId('schema-views').getByRole('button', { name: 'Keys' }).click();
  await page.getByRole('button', { name: 'Fit' }).click();
  await shot(page, 'schema-views');

  // Drag a column onto another table's column: the popover that adds the ref.
  await page.getByTestId('schema-views').getByRole('tab', { name: /All tables/ }).click();
  await page.getByRole('combobox', { name: 'DBML' }).fill('Table products {\n  id integer [pk]\n  name varchar\n}\n\nTable reviews {\n  id integer [pk]\n  product_id integer\n  stars integer\n}\n');
  await page.getByRole('button', { name: 'Auto-arrange' }).click();
  await page.waitForTimeout(300);
  const centre = async (testId: string) => {
    const b = (await page.getByTestId(testId).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const from = await centre('schema-col-reviews-product_id');
  const to = await centre('schema-col-products-id');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('schema-ref-ask')).toBeVisible();
  await shot(page, 'schema-add-ref', page.getByTestId('schema-ref-ask'), { pad: 24 });
});

test('schema import and export', async ({ page }) => {
  await start(page);
  await openShopSchema(page);
  await page.getByRole('button', { name: 'Export' }).click();
  await shot(page, 'schema-export-menu', page.getByRole('menu'));
  await page.getByRole('menuitem', { name: /SQL/ }).click();
  const sql = page.getByRole('dialog', { name: 'Export as SQL' });
  await sql.getByLabel('Database').selectOption({ label: 'PostgreSQL' });
  await expect(sql.getByTestId('export-sql-preview')).toContainText('CREATE TABLE');
  await shot(page, 'schema-export-sql', sql);
  await sql.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Import SQL' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import SQL' });
  await dialog.getByLabel('SQL').fill(
    [
      'CREATE TABLE suppliers (',
      '  id serial PRIMARY KEY,',
      '  name text NOT NULL,',
      '  email text UNIQUE',
      ');',
      '',
      'CREATE TABLE deliveries (',
      '  id serial PRIMARY KEY,',
      '  supplier_id integer NOT NULL REFERENCES suppliers (id),',
      '  arrived date',
      ');',
      '',
      "INSERT INTO suppliers (name) VALUES ('Acme');",
    ].join('\n'),
  );
  await expect(dialog.getByTestId('import-sql-found')).toHaveText('2 tables, 1 ref, 1 row found.');
  await shot(page, 'schema-import-sql', dialog);
});

test('schema versions', async ({ page }) => {
  await start(page);
  await openShopSchema(page);
  await page.getByRole('button', { name: 'Versions' }).click();
  let dialog = page.getByRole('dialog', { name: 'Schema versions' });
  await dialog.getByLabel('Label').fill('First design');
  await dialog.getByRole('button', { name: 'Save version' }).click();
  await expect(dialog.getByTestId('version-First design')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Since then: a phone column, a longer name, and products gone.
  const text = fixtureText('dbml/shop.dbml')
    .replace("  name varchar(100) [not null]\n", "  name varchar(200) [not null]\n  phone varchar(20)\n")
    .replace(/Table products \{[^}]*\}\n\n/, '')
    .replace('Ref: order_items.product_id > products.id\n', '');
  await page.getByRole('combobox', { name: 'DBML' }).fill(text);
  await expect(page.getByTestId('schema-table-products')).toHaveCount(0);
  await page.getByRole('button', { name: 'Versions' }).click();
  dialog = page.getByRole('dialog', { name: 'Schema versions' });
  await expect(dialog.getByTestId('version-changes')).toContainText('phone');
  await shot(page, 'schema-versions', dialog);
  await dialog.getByRole('tab', { name: 'Migration' }).click();
  await expect(dialog.getByTestId('migration-preview')).toContainText('ALTER TABLE');
  await shot(page, 'schema-versions-migration', dialog);
});

test('schema share and sample data', async ({ page }) => {
  await start(page);
  await openShopSchema(page);
  await page.getByRole('button', { name: 'Share' }).click();
  const share = page.getByRole('dialog', { name: 'Share the schema' });
  await expect(share.getByTestId('share-notice')).toBeVisible();
  await share.getByRole('switch', { name: 'Embed the diagram in another page' }).click();
  await expect(share.getByTestId('share-embed')).toBeVisible();
  await shot(page, 'schema-share', share);
  await share.getByRole('button', { name: 'Close' }).click();

  await page.getByTestId('schema-table-order_items').locator('.puddle-schema-table__head').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Fill with sample data…' }).click();
  const fill = page.getByRole('dialog', { name: 'Fill with sample data' });
  await fill.getByLabel('Rows per table').fill('20');
  await expect(fill.getByTestId('fill-sample-tables')).toContainText('order_items');
  await shot(page, 'schema-fill-sample', fill);
  await fill.getByRole('button', { name: 'Fill' }).click();
  await expect(fill).toBeHidden();
  // A table's data sample, on hovering its header.
  await page.getByTestId('schema-table-orders').locator('.puddle-schema-table__head').hover();
  await expect(page.getByTestId('schema-sample').locator('tbody tr')).toHaveCount(5, { timeout: 20_000 });
  await shot(page, 'schema-data-sample', page.getByTestId('schema-popover'));
});

test('schema tables', async ({ page }) => {
  await start(page);
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
  await page.getByRole('combobox', { name: 'DBML' }).fill(fixtureText('dbml/tables.dbml'));
  await page.getByRole('button', { name: 'Back to canvas' }).click();
  await addFiles(page, [fixture('shop-customers.csv')]);
  await expect(node(page, 'shop-customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, 'shop-customers.csv').click({ button: 'right' });
  await shot(page, 'schema-load-into', page.getByTestId('context-menu'));
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Load into customers' }).click();
  await expect(node(page, 'customers')).toHaveAttribute('data-status', 'error', { timeout: 20_000 });
  await selectNode(page, 'customers');
  await expect(page.getByTestId('table-failures')).toBeVisible();
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await shot(page, 'schema-table-node');
});

test('schema check', async ({ page }) => {
  await start(page);
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
  await page.getByRole('combobox', { name: 'DBML' }).fill(fixtureText('dbml/rules.dbml'));
  await page.getByRole('button', { name: 'Back to canvas' }).click();
  await addFiles(page, [fixture('schema-rules-customers.csv')]);
  await expect(node(page, 'schema-rules-customers.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await selectNode(page, 'schema-rules-customers.csv');
  await page.getByLabel('Check against the schema').selectOption('public.customers');
  const rules = page.getByTestId('rules');
  await expect(rules.locator('.ui-rule').filter({ hasText: 'id is unique' }).first()).toHaveAttribute('data-status', 'fail', { timeout: 20_000 });
  // The Rules section from its heading down to the last rule, without the suggestions below.
  await page.setViewportSize({ width: 1440, height: 1800 });
  await page.getByTestId('rules').scrollIntoViewIfNeeded();
  const top = (await page.getByLabel('Check against the schema').boundingBox())!;
  const list = (await page.getByTestId('rules').boundingBox())!;
  const y = top.y - 60;
  await shotClip(page, 'schema-check', { x: list.x - 8, y, width: list.width + 16, height: list.y + list.height - y + 8 });
});
