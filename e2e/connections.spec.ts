import { expect, test, type Page } from '@playwright/test';
import { addFiles, cell, expectRows, fixture, node, openApp, saved, selectNode } from './helpers/app';

// A database connection: made from the driver grid, tested (no service runs here, so the test says what to start),
// saved in the project without its password, signed in for this tab, listed under Project › Databases and on the
// home screen, and forgotten from there.
const projectMenu = async (page: Page, item: string | RegExp) => {
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: item }).click();
};

test('a PostgreSQL connection is saved without its password and signed in for the tab', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /From database/ }).click();
  const list = page.getByRole('dialog', { name: 'Add source from a database' });
  await expect(list).toContainText('No connections yet');
  await list.getByRole('button', { name: 'New connection' }).click();

  const grid = page.getByRole('dialog', { name: 'New connection' }).getByTestId('driver-grid');
  await expect(grid.getByRole('listitem')).toHaveCount(25);
  await grid.getByRole('listitem', { name: 'PostgreSQL', exact: true }).click();

  const form = page.getByRole('dialog', { name: 'New PostgreSQL connection' });
  await expect(form.getByLabel('Port')).toHaveValue('5432');
  await expect(form.getByRole('button', { name: 'Save connection' })).toBeDisabled();
  await form.getByLabel('Host').fill('db.local');
  await form.getByLabel('Database').fill('shop');
  await form.getByLabel('User name').fill('kev');
  await form.getByLabel('Password').fill('hunter2');
  await expect(form.getByLabel('Where it runs')).toHaveValue('local');
  await form.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(form.getByTestId('conn-test')).toHaveAttribute('data-ok', 'false', { timeout: 20_000 });
  // puddle-connect runs for the suite (started by the Playwright config); there is no such host to reach.
  await expect(form.getByTestId('conn-test')).toContainText('Nothing answers at db.local:5432');
  await form.getByRole('button', { name: 'Save connection' }).click();

  // Saved: the tables are asked for next, which fails the same way; back to the list.
  const picker = page.getByRole('dialog', { name: 'Read from PostgreSQL' });
  await expect(picker).toContainText('Nothing answers at db.local:5432', { timeout: 20_000 });
  await page.keyboard.press('Escape');
  const row = list.getByTestId('connection-PostgreSQL');
  await expect(row).toContainText('PostgreSQL · kev@db.local:5432/shop · on this computer · signed in');
  await expect(row).not.toContainText('not signed in');
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);

  // The project holds the connection and no password; the tab keeps the password through a reload.
  await expect.poll(async () => JSON.stringify(await saved(page))).toContain('db.local');
  expect(JSON.stringify(await saved(page))).not.toContain('hunter2');
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await projectMenu(page, 'Databases');
  const manage = page.getByRole('dialog', { name: 'Databases' });
  await expect(manage.getByTestId('connection-PostgreSQL')).not.toContainText('not signed in');
  await expect(manage.getByTestId('connection-PostgreSQL')).toContainText('signed in');
  await page.keyboard.press('Escape');

  // The home screen lists it across projects, and forgets every secret in one click.
  await projectMenu(page, 'All projects');
  const home = page.getByTestId('home-connections');
  await expect(home.getByTestId('home-connection-PostgreSQL')).not.toContainText('not signed in');
  await home.getByRole('button', { name: 'Forget all secrets' }).click();
  await expect(home.getByTestId('home-connection-PostgreSQL')).toContainText('not signed in');
});

// A SQLite file as a database: the file is chosen in the connection form and tested in the browser, the tables
// are picked (and a query written) into sources, the row limit is changed in the inspector, and after a reload
// the file is chosen again from the results pane.
test('a SQLite file is read in the browser: tables and a query become sources, and the file is chosen again after a reload', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /From database/ }).click();
  await page.getByRole('dialog', { name: 'Add source from a database' }).getByRole('button', { name: 'New connection' }).click();
  await page.getByRole('dialog', { name: 'New connection' }).getByRole('listitem', { name: 'SQLite', exact: true }).click();

  const form = page.getByRole('dialog', { name: 'New SQLite connection' });
  await expect(form.getByRole('button', { name: 'Save connection' })).toBeDisabled();
  await form.locator('[data-testid^="connection-file-"]').setInputFiles(fixture('db/shop.sqlite'));
  await expect(form.getByTestId('conn-file-name')).toHaveText('shop.sqlite');
  await form.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(form.getByTestId('conn-test')).toHaveAttribute('data-ok', 'true');
  await expect(form.getByTestId('conn-test')).toContainText('SQLite file, 3 tables');
  await form.getByRole('button', { name: 'Save connection' }).click();

  const picker = page.getByRole('dialog', { name: 'Read from SQLite' });
  // The tables are read in the SQLite worker; under a loaded CI runner that takes a moment.
  await expect(picker.getByTestId('table-picker')).toContainText('order_totals (view)', { timeout: 20_000 });
  await expect(picker.getByTestId('pick-orders')).toContainText('4 columns · 4 rows');
  await picker.getByRole('checkbox', { name: 'orders' }).check();
  await picker.getByLabel('Or a query').fill('SELECT name, orders FROM order_totals ORDER BY name');
  await picker.getByLabel('At most').fill('2');
  await picker.getByRole('button', { name: 'Add 2 sources' }).click();
  await expect(picker).toHaveCount(0);

  await expect(node(page, 'orders')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'SQLite query')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, 'SQLite query').click();
  await expectRows(page, 2);
  await expect(cell(page, 0, 0)).toHaveText('Ada Lovelace');

  // The inspector reads the table again without the limit.
  await node(page, 'orders').click();
  await expectRows(page, 2);
  await expect(page.getByTestId('connection-panel')).toContainText('SQLite (SQLite)');
  await page.getByLabel('At most').fill('');
  await page.getByLabel('At most').press('Enter');
  await expectRows(page, 4);
  await expect(page.getByTestId('connection-read')).toContainText('4 rows read');

  // The project keeps the connection and its file's name, not the file: a new tab asks for it again.
  await expect.poll(async () => JSON.stringify(await saved(page))).toContain('"shop.sqlite"');
  await expect.poll(async () => JSON.stringify((await saved(page))?.sources[0])).not.toContain('"limit"');
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  await expect(node(page, 'orders')).toHaveAttribute('data-status', 'detached', { timeout: 20_000 });
  await expect(node(page, 'orders')).toContainText('Choose the database file in the inspector.');
  await selectNode(page, 'orders');
  const banner = page.getByTestId('results-connection');
  await expect(banner).toContainText('choose shop.sqlite again');
  await banner.locator('[data-testid^="connection-file-"]').setInputFiles(fixture('db/shop.sqlite'));
  await expect(node(page, 'orders')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expectRows(page, 4);
});

// A DuckDB file chosen like any other file is a connection, not a source: its table picker opens at once.
test('a DuckDB file chosen from Add › Choose files opens its table picker, and the table is attached read-only', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('db/shop.duckdb')]);
  const picker = page.getByRole('dialog', { name: 'Read from shop' });
  await expect(picker.getByTestId('table-picker')).toContainText('order_totals (view)', { timeout: 20_000 });
  await expect(picker.getByTestId('pick-customers')).toContainText('5 columns');
  await picker.getByRole('checkbox', { name: 'customers' }).check();
  await picker.getByRole('button', { name: 'Add 1 source' }).click();
  await expect(node(page, 'customers')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expectRows(page, 3);
  await expect(cell(page, 1, 0)).toHaveText('Ada Lovelace');
  await expect(page.getByTestId('connection-panel')).toContainText('shop (DuckDB)');
});

// The database browser: opened from the connection list, searched, a table previewed, two tables and a query added.
test('the database browser lists a SQLite file’s tables, previews one, and adds ticked tables and a query as sources', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('db/shop.sqlite')]);
  const picker = page.getByRole('dialog', { name: 'Read from shop' });
  await expect(picker.getByTestId('table-picker')).toContainText('customers', { timeout: 20_000 });
  await page.keyboard.press('Escape');
  const list = page.getByRole('dialog', { name: 'Add source from a database' });
  await list.getByTestId('connection-shop').getByRole('button', { name: 'Browse' }).click();
  await expect(list).toHaveCount(0);

  const browser = page.getByTestId('database-browser');
  await expect(browser.getByTestId('browser-name')).toHaveText('shop');
  await expect(browser).toContainText('2 tables, 1 view');
  await expect(browser.getByRole('tree', { name: 'Tables' }).getByRole('listitem')).toHaveCount(3);
  await browser.getByLabel('Search tables and columns').fill('ord');
  await expect(browser.getByRole('tree', { name: 'Tables' }).getByRole('listitem')).toHaveCount(2);
  await expect(browser.getByTestId('browse-customers')).toHaveCount(0);
  await browser.getByRole('button', { name: 'Show the columns of orders' }).click();
  await expect(browser.getByRole('list', { name: 'Columns of orders' })).toContainText('customer_id');
  await browser.getByTestId('browse-orders').getByRole('button', { name: 'orders', exact: true }).click();
  await expect(browser.getByTestId('browse-preview')).toHaveAttribute('data-rows', '4', { timeout: 20_000 });
  await expect(browser.getByTestId('browse-preview')).toContainText('19.99');

  await browser.getByRole('button', { name: 'Close the preview' }).click();
  await browser.getByLabel('Search tables and columns').fill('');
  await browser.getByRole('checkbox', { name: 'Add customers' }).check();
  await browser.getByRole('checkbox', { name: 'Add orders' }).check();
  await browser.getByRole('button', { name: 'Add 2 tables' }).click();
  await expect(node(page, 'customers')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'orders')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await browser.getByLabel('Query').fill('SELECT name FROM customers ORDER BY name');
  await browser.getByRole('button', { name: 'Add query' }).click();
  await expect(node(page, 'shop query')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await browser.getByRole('button', { name: 'Close the database browser' }).click();
  await expect(page.getByTestId('inspector-tabs')).toBeVisible();
});

test('documenting a SQLite file writes its tables into the Schema view as a group, and the Relationships view draws the ref between two added tables', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('db/shop.sqlite')]);
  const picker = page.getByRole('dialog', { name: 'Read from shop' });
  await expect(picker.getByTestId('table-picker')).toContainText('customers', { timeout: 20_000 });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Add source from a database' }).getByTestId('connection-shop').getByRole('button', { name: 'Browse' }).click();
  const browser = page.getByTestId('database-browser');
  await expect(browser).toContainText('2 tables, 1 view');

  // Document the whole database: the dialog says what it will write, then writes it.
  await browser.getByRole('button', { name: 'Document the schema' }).click();
  const dialog = page.getByRole('dialog', { name: 'Document the schema' });
  await expect(dialog.getByTestId('document-plan')).toContainText('3 tables, 1 ref and 0 enums', { timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Document', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // Two tables added now are checked against their documented tables.
  await browser.getByRole('checkbox', { name: 'Add customers' }).check();
  await browser.getByRole('checkbox', { name: 'Add orders' }).check();
  await browser.getByRole('button', { name: 'Add 2 tables' }).click();
  await expect(node(page, 'orders')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await browser.getByRole('button', { name: 'Close the database browser' }).click();
  await selectNode(page, 'orders');
  await expect(page.getByTestId('inspector')).toContainText('Every customer_id exists in customers.id');

  await projectMenu(page, 'Schema');
  const schema = page.getByTestId('schema-view');
  await expect(schema.getByTestId('schema-group-shop')).toBeVisible();
  await expect(schema.getByTestId('schema-table-orders')).toContainText('customer_id');
  await expect(schema.getByTestId('schema-ref-orders-customers')).toBeAttached();
  await schema.getByRole('button', { name: 'Back to canvas' }).click();

  await projectMenu(page, /Relationships/);
  const rel = page.getByTestId('relationships');
  await expect(rel.getByTestId('relationship-line')).toHaveCount(1);
  await expect(rel.getByTestId('relationship').first()).toContainText('Ref in the schema');
  // Documented, dated, in the Databases list.
  await rel.getByRole('button', { name: 'Back to canvas' }).click();
  await projectMenu(page, 'Databases');
  await expect(page.getByRole('dialog', { name: 'Databases' }).getByTestId('connection-shop')).toContainText('documented');
});

test('a SQLite file on this computer is read through puddle-connect: found at localhost, tested, and a table read', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /From database/ }).click();
  const list = page.getByRole('dialog', { name: 'Add source from a database' });
  await list.getByRole('button', { name: 'New connection' }).click();
  await page.getByRole('dialog', { name: 'New connection' }).getByTestId('driver-grid').getByRole('listitem', { name: 'SQLite', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New SQLite connection' });
  // The service started by the test suite answers at localhost:8765, so the route says so, and the file is a path there.
  await form.getByLabel('Where it runs').selectOption('local');
  await expect(form.getByLabel('Where it runs')).toContainText('On this computer (found)');
  await expect(form.getByRole('button', { name: 'Choose file' })).toHaveCount(0);
  await form.getByLabel('Path of the database file').fill(`${process.cwd()}/tests/fixtures/db/shop.sqlite`);
  await form.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(form.getByTestId('conn-test')).toHaveAttribute('data-ok', 'true');
  await expect(form.getByTestId('conn-test')).toContainText('SQLite file, 3 tables');
  await form.getByRole('button', { name: 'Save connection' }).click();

  const picker = page.getByRole('dialog', { name: 'Read from SQLite' });
  await expect(picker.getByTestId('table-picker')).toContainText('orders', { timeout: 20_000 });
  await picker.getByTestId('pick-orders').click();
  await picker.getByRole('button', { name: 'Add 1 source' }).click();
  await expect(node(page, 'orders')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await selectNode(page, 'orders');
  await expect(page.getByTestId('connection-read')).toContainText('4 rows');
});

// A PostgreSQL server (PUDDLE_TEST_POSTGRES, a URL to the seeded shop; CI starts one) read through puddle-connect:
// connected and tested, a table added as a source, the database browsed, and its schema documented with its enum.
test('a PostgreSQL database is read through puddle-connect: tested, a table added, browsed and its schema documented', async ({ page }) => {
  const url = process.env.PUDDLE_TEST_POSTGRES;
  test.skip(!url, 'PUDDLE_TEST_POSTGRES names no server');
  const u = new URL(url!);
  await openApp(page);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /From database/ }).click();
  const list = page.getByRole('dialog', { name: 'Add source from a database' });
  await list.getByRole('button', { name: 'New connection' }).click();
  await page.getByRole('dialog', { name: 'New connection' }).getByTestId('driver-grid').getByRole('listitem', { name: 'PostgreSQL', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New PostgreSQL connection' });
  await form.getByLabel('Host').fill(u.hostname);
  await form.getByLabel('Port').fill(u.port || '5432');
  await form.getByLabel('Database').fill(u.pathname.slice(1));
  await form.getByLabel('User name').fill(decodeURIComponent(u.username));
  await form.getByLabel('Password').fill(decodeURIComponent(u.password));
  await expect(form.getByLabel('Where it runs')).toContainText('On this computer (found)');
  await form.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(form.getByTestId('conn-test')).toHaveAttribute('data-ok', 'true', { timeout: 20_000 });
  await expect(form.getByTestId('conn-test')).toContainText('3 tables');
  await form.getByRole('button', { name: 'Save connection' }).click();

  const picker = page.getByRole('dialog', { name: 'Read from PostgreSQL' });
  await expect(picker.getByTestId('table-picker')).toContainText('orders', { timeout: 20_000 });
  await picker.getByTestId('pick-orders').click();
  await picker.getByRole('button', { name: 'Add 1 source' }).click();
  await expect(node(page, 'orders')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await selectNode(page, 'orders');
  await expect(page.getByTestId('connection-read')).toContainText('4 rows');

  // Browse it and document it: the enum comes along, and the orders source is checked against its table.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /From database/ }).click();
  await list.getByTestId('connection-PostgreSQL').getByRole('button', { name: 'Browse' }).click();
  const browser = page.getByTestId('database-browser');
  await expect(browser).toContainText('2 tables, 1 view', { timeout: 20_000 });
  await browser.getByRole('button', { name: 'Document the schema' }).click();
  const dialog = page.getByRole('dialog', { name: 'Document the schema' });
  await expect(dialog.getByTestId('document-plan')).toContainText('3 tables, 1 ref and 1 enum', { timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Document', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await browser.getByRole('button', { name: 'Close the database browser' }).click();
  await projectMenu(page, 'Schema');
  const schema = page.getByTestId('schema-view');
  await expect(schema.getByTestId('schema-group-PostgreSQL')).toBeVisible();
  await expect(schema.getByTestId('schema-table-orders')).toContainText('order_status');
});
