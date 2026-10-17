import { expect, test, type Locator, type Page } from '@playwright/test';
import { addFiles, addStep, cell, fixture, node, openApp } from './helpers/app';

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');

const projectMenu = async (page: Page, item: string) => {
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: item }).click();
};

/** Open the templates library from the Add node menu. */
async function openLibrary(page: Page) {
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: /From template/ }).click();
  return page.getByRole('dialog', { name: 'Templates' });
}

const templateList = (library: Locator) => library.getByRole('listbox', { name: 'Templates library' });

/** Every stored template, as IndexedDB holds it. */
const storedTemplates = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<unknown[]>((resolve) => {
        const req = indexedDB.open('puddle');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('templates')) return resolve([]);
          const all = db.transaction('templates').objectStore('templates').getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => resolve([]);
        };
        req.onerror = () => resolve([]);
      }),
  );

test('a node saved as a template goes into another project, with a missing column mapped or left off', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  await node(page, 'Transform 1').click();
  await addStep(page, 'Trim whitespace');
  await addStep(page, 'Change case');
  await expect(steps(page)).toHaveText([/Trimmed name/, /Changed name to title case/]);

  // Save as template: the steps, and the input columns they read.
  await page.getByRole('button', { name: 'Save as template' }).click();
  const save = page.getByRole('dialog', { name: 'Save as template' });
  await expect(save.getByTestId('template-expected')).toHaveText('Abcname');
  await save.getByLabel('Name', { exact: true }).fill('Tidy names');
  await save.getByLabel('Description').fill('Trims and title-cases names.');
  await save.getByRole('button', { name: 'Save template' }).click();
  await expect(save).toHaveCount(0);
  await expect(page.getByTestId('canvas-notice')).toContainText('Saved “Tidy names” as a template.');

  // A new project reading the same rows, where the column is called full_name.
  await projectMenu(page, 'All projects');
  await page.getByRole('button', { name: 'New project' }).click();
  await addFiles(page, [fixture('contacts.csv')]);
  await expect(node(page, 'contacts.csv')).toHaveAttribute('data-status', 'ok');
  await node(page, 'contacts.csv').click();

  let library = await openLibrary(page);
  await library.getByLabel('Search templates').fill('title-cases');
  await templateList(library).getByRole('option', { name: 'Tidy names' }).click();
  const detail = library.getByTestId('template-detail');
  await expect(detail.getByRole('listbox', { name: 'Applied steps' }).getByRole('option')).toHaveText([/Trimmed name/, /Changed name to title case/]);
  await expect(library.getByTestId('template-mapping')).toContainText('1 column isn’t in the input');
  await library.getByLabel('Use for name').selectOption('full_name');
  await library.getByRole('button', { name: 'Insert template' }).click();

  await expect(node(page, 'Tidy names')).toHaveAttribute('data-status', 'ok');
  await expect(steps(page)).toHaveText([/Trimmed full_name/, /Changed full_name to title case/]);
  await steps(page).nth(1).click();
  await expect(page.getByTestId('results-title')).toHaveText('Tidy names · step 2');
  await expect(cell(page, 1, 0)).toHaveText('Ada Lovelace');
  await expect(cell(page, 1, 1)).toHaveText('Grace Hopper');

  // Inserting was one undo step: the node and its wire go together.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(node(page, 'Tidy names')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(node(page, 'Tidy names')).toHaveAttribute('data-status', 'ok');

  // Left unmapped, the steps arrive turned off and say why.
  await node(page, 'contacts.csv').click();
  library = await openLibrary(page);
  await templateList(library).getByRole('option', { name: 'Tidy names' }).click();
  await expect(library.getByLabel('Use for name')).toHaveValue('');
  await library.getByRole('button', { name: 'Insert template' }).click();
  await expect(node(page, 'Tidy names 2')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('canvas-notice')).toContainText('2 of 2 steps arrived turned off');
  await expect(steps(page).nth(0)).toHaveAttribute('aria-disabled', 'true');
  // Playwright won't click an aria-disabled option; Enter selects it as a click would.
  await steps(page).nth(0).press('Enter');
  await expect(page.getByTestId('step-settings')).toContainText('Needs name, which the input doesn’t have.');

  // The template survives a reload, and what's stored is steps and column names, never the rows.
  await page.reload();
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  library = await openLibrary(page);
  await expect(templateList(library).getByRole('option')).toHaveText([/Tidy names.*Trims and title-cases names\..*2 steps · expects name/]);
  await templateList(library).getByRole('option').click();
  await expect(library.getByText('No node is selected, so it goes on the canvas unwired')).toBeVisible();
  const stored = JSON.stringify(await storedTemplates(page));
  expect(stored).toContain('"expectedColumns":[{"name":"name","type":"VARCHAR"}]');
  for (const value of ['Lovelace', 'hopper', 'example.com']) expect(stored).not.toContain(value);
});

test('templates are renamed, described and deleted from the library', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  await node(page, 'Transform 1').click();
  await expect(page.getByRole('button', { name: 'Save as template' })).toBeDisabled();
  await addStep(page, 'Trim whitespace');
  await page.getByRole('button', { name: 'Save as template' }).click();
  await page.getByRole('dialog', { name: 'Save as template' }).getByRole('button', { name: 'Save template' }).click();

  const library = await openLibrary(page);
  await templateList(library).getByRole('option', { name: 'Transform 1' }).click();
  await library.getByRole('button', { name: 'Rename or describe' }).click();
  await library.getByLabel('Template name').fill('Trim names');
  await library.getByLabel('Template description').fill('For contact lists.');
  await library.getByRole('button', { name: 'Save changes' }).click();
  await expect(templateList(library).getByRole('option', { name: 'Trim names' })).toContainText('For contact lists.');
  await library.getByLabel('Search templates').fill('contact');
  await expect(templateList(library).getByRole('option')).toHaveCount(1);
  await library.getByLabel('Search templates').fill('dates');
  await expect(library.getByText('No templates match.')).toBeVisible();
  await library.getByLabel('Search templates').fill('');

  await library.getByRole('button', { name: 'Delete', exact: true }).click();
  await library.getByRole('button', { name: 'Delete template' }).click();
  await expect(library.getByText('No templates yet.')).toBeVisible();
  expect(await storedTemplates(page)).toEqual([]);
});
