import { expect, test, type Page } from '@playwright/test';
import { cell, fixture, node, openApp, selectNode } from './helpers/app';
import { expectAccessible } from './helpers/axe';

const projectMenu = async (page: Page, item: string) => {
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: item }).click();
};

const goHome = async (page: Page) => {
  await projectMenu(page, 'All projects');
  await expect(page.getByTestId('home')).toBeVisible();
};

/** Use a recipe from the gallery on the home screen. */
async function useGalleryRecipe(page: Page, name: string) {
  const card = page.getByTestId('recipe-gallery').getByRole('listitem', { name });
  await card.getByRole('button', { name: 'Use recipe' }).click();
  await expect(page.getByTestId('recipe-attach')).toBeVisible();
}

const json = (name: string, data: unknown) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });

test('a gallery recipe and a matching file make a runnable project, and it exports as a recipe with no data', async ({ page }) => {
  await openApp(page);
  await goHome(page);
  const gallery = page.getByTestId('recipe-gallery');
  await expect(gallery.getByRole('listitem')).toHaveCount(4);
  const card = gallery.getByRole('listitem', { name: 'Tidy a contact list' });
  await expect(card).toContainText('Trims stray spaces');
  await expect(card).toContainText('AbcnameAbcemailAbccity');
  await expectAccessible(page, 'the home screen with the recipe gallery');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectAccessible(page, 'the recipe gallery in the dark theme');
  await page.emulateMedia({ colorScheme: 'light' });

  await useGalleryRecipe(page, 'Tidy a contact list');
  const attach = page.getByTestId('recipe-attach');
  await expect(attach).toContainText('Attach a file to run this recipe');
  await expect(attach.getByRole('listitem', { name: 'Contact list expects' })).toContainText('AbcnameAbcemailAbccity');
  await expect(node(page, 'Clean contacts')).toBeVisible();
  await expectAccessible(page, 'the attach prompt');

  // A file with the columns the recipe expects: no questions, and the project runs.
  await page.locator('[data-testid^="reattach-"]').first().setInputFiles(fixture('recipes/contacts.csv'));
  await expect(attach).toHaveCount(0);
  await expect(node(page, 'Clean contacts')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await selectNode(page, 'Clean contacts');
  await expect(cell(page, 0, 0)).toHaveText('Alice Patel');
  await expect(cell(page, 1, 0)).toHaveText('alice.patel@example.com');
  await expect(cell(page, 3, 0)).toHaveText('Manchester');
  await expect(page.getByTestId('attachment-banner')).toHaveCount(0);

  await projectMenu(page, 'Share as recipe');
  const dialog = page.getByRole('dialog', { name: 'Share as recipe' });
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Tidy a contact list');
  await dialog.getByLabel('Name', { exact: true }).fill('Our contacts');
  await dialog.getByLabel('Description').fill('How we tidy the contact list.');
  await expectAccessible(page, 'the export recipe dialog');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Share as recipe' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('our-contacts.puddle-recipe.json');
  const text = Buffer.concat(await (await file.createReadStream()).toArray()).toString('utf8');
  const recipe = JSON.parse(text);
  expect(recipe).toMatchObject({ puddleRecipe: 1, kind: 'pipeline', name: 'Our contacts', description: 'How we tidy the contact list.' });
  expect(recipe.sources).toEqual([expect.objectContaining({ name: 'Contact list', kind: 'file', format: 'csv' })]);
  for (const leak of ['contacts.csv', 'alice', 'Alice', 'Manchester', '07700', 'headHash', 'originalName', 'exportLog', '"view"']) expect(text).not.toContain(leak);

  // Opening it again gives a new project waiting for its file.
  await projectMenu(page, 'Open recipe');
  await page.getByTestId('recipe-input').setInputFiles({ name: 'our-contacts.puddle-recipe.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.getByTestId('project-menu')).toContainText('Our contacts');
  await expect(page.getByTestId('recipe-attach')).toContainText('Contact list');
});

test('a file whose columns differ is matched to the recipe’s, and steps needing a missing column turn off', async ({ page }) => {
  await openApp(page);
  await goHome(page);
  await useGalleryRecipe(page, 'Tidy a contact list');
  // tests/fixtures/contacts.csv has full_name and Email, and no city.
  await page.locator('[data-testid^="reattach-"]').first().setInputFiles(fixture('contacts.csv'));
  const dialog = page.getByRole('dialog', { name: 'Match the columns of Contact list' });
  await expect(dialog.getByTestId('recipe-mapping')).toContainText('2 columns aren’t in the input');
  await dialog.getByLabel('Use for name').selectOption('full_name');
  await expect(dialog.getByLabel('Use for city')).toHaveValue('');
  await expectAccessible(page, 'the column matching dialog');
  await dialog.getByRole('button', { name: 'Use these columns' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('canvas-notice')).toContainText('2 steps are turned off');
  await page.getByTestId('canvas-notice').getByRole('button', { name: 'Dismiss' }).click();

  await expect(node(page, 'Clean contacts')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await selectNode(page, 'Tidy contacts');
  const steps = page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');
  await expect(steps.first()).toContainText('Renamed full_name to name');
  await selectNode(page, 'Clean contacts');
  await expect(cell(page, 1, 0)).toHaveText('Ada Lovelace');
  await expect(cell(page, 2, 0)).toHaveText('ada@example.com');
});

test('a recipe from a newer Puddle, or with a step Puddle doesn’t know, is refused with a message', async ({ page }) => {
  await openApp(page);
  await goHome(page);
  const input = page.getByTestId('recipe-input');
  await input.setInputFiles(json('future.puddle-recipe.json', { puddleRecipe: 99, kind: 'pipeline', formatVersion: 1, name: 'Future', sources: [], nodes: [], edges: [] }));
  await expect(page.getByTestId('home').getByRole('alert')).toContainText('This recipe was made by a newer version of Puddle. Update Puddle to open it.');
  await input.setInputFiles(
    json('odd.puddle-recipe.json', {
      puddleRecipe: 1,
      kind: 'pipeline',
      formatVersion: 1,
      name: 'Odd',
      sources: [],
      nodes: [{ id: 't', type: 'transform', name: 'T', steps: [{ id: 'a', type: 'teleportRows', label: 'Teleported', params: {} }] }],
      edges: [],
    }),
  );
  await expect(page.getByTestId('home').getByRole('alert')).toContainText('This recipe uses a step (“teleportRows”) this version of Puddle doesn’t know');
  await expect(page.getByTestId('home')).toBeVisible();
});

test('templates export and import as single-node recipes', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: /From template/ }).click();
  const library = page.getByRole('dialog', { name: 'Templates' });
  const template = {
    puddleRecipe: 1,
    kind: 'template',
    formatVersion: 1,
    name: 'Shout names',
    description: 'Upper-cases names.',
    notes: 'Upper-cases names.',
    sources: [],
    nodes: [{ id: 'template', type: 'transform', name: 'Shout names', position: { x: 0, y: 0 }, rules: [], steps: [{ id: 'a', type: 'changeCase', label: 'Changed name to upper case', enabled: true, params: { columns: ['name'], mode: 'upper' } }] }],
    edges: [],
    expectedColumns: [{ name: 'name', type: 'VARCHAR' }],
  };
  await library.getByTestId('template-import-input').setInputFiles(json('shout-names.puddle-recipe.json', template));
  await expect(library).toContainText('Added “Shout names” to your templates.');
  await expect(library.getByRole('option', { name: 'Shout names' })).toHaveAttribute('aria-selected', 'true');
  const detail = library.getByTestId('template-detail');
  await expect(detail.getByRole('listbox', { name: 'Applied steps' }).getByRole('option')).toHaveText([/Changed name to upper case/]);

  const download = page.waitForEvent('download');
  await detail.getByRole('button', { name: 'Save to file' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('shout-names.puddle-recipe.json');
  const exported = JSON.parse(Buffer.concat(await (await file.createReadStream()).toArray()).toString('utf8'));
  expect(exported).toMatchObject({ puddleRecipe: 1, kind: 'template', name: 'Shout names', description: 'Upper-cases names.', sources: [], expectedColumns: template.expectedColumns });
  expect(exported.nodes[0].steps).toEqual([expect.objectContaining({ type: 'changeCase', params: { columns: ['name'], mode: 'upper' } })]);

  // A whole pipeline isn't a template.
  await library.getByTestId('template-import-input').setInputFiles(json('pipeline.puddle-recipe.json', { ...template, kind: 'pipeline' }));
  await expect(library).toContainText('This recipe is a whole pipeline, not a template.');
});
