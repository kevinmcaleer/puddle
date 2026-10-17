import { expect, test, type Page } from '@playwright/test';
import { startFileServer, type FileServer } from '../tests/helpers/fileServer';
import { columnsOf, expectRows, fixtureText, node, openApp } from './helpers/app';

// OData feeds, from local servers that answer as TripPin does: one allows other sites to read it (CORS), one asks
// for a Basic sign-in, and one sends no CORS headers, the way many services on the web behave.
let open: FileServer;
let locked: FileServer;
let closed: FileServer;

function serveTrippin(server: FileServer) {
  const files: Record<string, string> = {
    '/$metadata': 'odata/trippin-metadata.xml',
    '/People': 'odata/trippin-people-1.json',
    '/People?%24skiptoken=4': 'odata/trippin-people-2.json',
    '/People?%24skiptoken=8': 'odata/trippin-people-3.json',
  };
  for (const [path, name] of Object.entries(files))
    server.files.set(`/trippin${path}`, {
      body: fixtureText(name).replaceAll('https://services.odata.org/TripPinRESTierService', server.url('/trippin')),
      type: name.endsWith('.xml') ? 'application/xml' : 'application/json',
    });
}

test.beforeAll(async () => {
  open = await startFileServer({ cors: true });
  locked = await startFileServer({ cors: true, authorization: 'Basic a2V2OnB1ZGRsZQ==' });
  closed = await startFileServer({ cors: false });
  for (const s of [open, locked, closed]) serveTrippin(s);
  // What TripPin answers for the women among People.
  const women = JSON.parse(fixtureText('odata/trippin-people-3.json')) as { value: unknown[] };
  open.files.set("/trippin/People?$filter=Gender%20eq%20%27Female%27", { body: JSON.stringify({ value: women.value }), type: 'application/json' });
});
test.afterAll(async () => {
  await Promise.all([open.close(), locked.close(), closed.close()]);
});

async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /From OData feed/ }).click();
  return page.getByRole('dialog', { name: 'Add source from an OData feed' });
}

test('TripPin’s People come in from an OData feed: connect, pick the entity set, filter, add', async ({ page }) => {
  await openApp(page);
  const dialog = await openDialog(page);
  await dialog.getByLabel('Address').fill(open.url('/trippin'));
  await dialog.getByRole('button', { name: 'Connect' }).click();

  const sets = dialog.getByTestId('odata-sets');
  await expect(dialog.getByLabel(/^Entity set/)).toHaveValue('People');
  await expect(sets).toContainText('11 columns: UserName, FirstName, LastName, MiddleName, Gender, Age and 5 more. OData version 4.');
  await dialog.getByLabel('Filter').fill("Gender eq 'Female'");
  await dialog.getByRole('button', { name: 'Add source' }).click();
  await expect(dialog).toHaveCount(0);

  const source = node(page, 'People');
  await expect(source).toHaveAttribute('data-status', 'ok');
  await expect(source).toContainText(`${new URL(open.url('/')).host} · OData`);
  await expectRows(page, 2);
  expect((await columnsOf(page, 'People')).slice(0, 6)).toEqual(['UserName', 'FirstName', 'LastName', 'MiddleName', 'Gender', 'Age']);
  await expect(page.getByTestId('odata-details')).toContainText("Gender eq 'Female'");
});

test('a service that needs a sign-in: Basic in the dialog, kept in the tab, and asked for again in a new one', async ({ page, context }) => {
  await openApp(page);
  const dialog = await openDialog(page);
  await dialog.getByLabel('Address').fill(locked.url('/trippin/People'));
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog.getByTestId('odata-error')).toHaveAttribute('data-kind', 'auth');
  await dialog.getByLabel('Sign-in').selectOption('basic');
  await dialog.getByLabel('User name').fill('kev');
  await dialog.getByLabel('Password').fill('puddle');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await dialog.getByRole('button', { name: 'Add source' }).click();
  await expect(dialog).toHaveCount(0);
  await expectRows(page, 10);

  // Saved without the password; a new tab has no sign-in, so it asks for one.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('puddle.lastProject'))).not.toBeNull();
  await page.waitForTimeout(800);
  await page.close();
  const tab = await context.newPage();
  await openApp(tab);
  await expect(node(tab, 'People')).toBeVisible();
  await node(tab, 'People').click();
  const signIn = tab.getByTestId('odata-sign-in');
  await expect(signIn).toBeVisible();
  await expect(tab.getByTestId('url-panel')).toContainText('Sign in to read this feed');
  await signIn.getByLabel('User name').fill('kev');
  await signIn.getByLabel('Password').fill('puddle');
  await signIn.getByRole('button', { name: 'Sign in and read' }).click();
  await expect(node(tab, 'People')).toHaveAttribute('data-status', 'ok');
  await expectRows(tab, 10);
});

test('a service that blocks other sites: Puddle says so, plainly', async ({ page }) => {
  await openApp(page);
  const dialog = await openDialog(page);
  await dialog.getByLabel('Address').fill(closed.url('/trippin'));
  await dialog.getByRole('button', { name: 'Connect' }).click();
  const error = dialog.getByTestId('odata-error');
  await expect(error).toHaveAttribute('data-kind', 'cors');
  await expect(error).toContainText('The service blocked this');
  await expect(error).toContainText('doesn’t allow other sites to read it (CORS)');
});
