import { expect, test, type Page } from '@playwright/test';
import { addFiles, cell, fixture, node, openApp } from './helpers/app';

const steps = (page: Page) => page.getByRole('listbox', { name: 'Applied steps' }).getByRole('option');

/** customers.csv wired into Transform 1, with Transform 1 selected. */
async function transform(page: Page) {
  await openApp(page);
  await addFiles(page, [fixture('customers.csv')]);
  await node(page, 'customers.csv').click();
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  await node(page, 'Transform 1').click();
}

async function addStep(page: Page, title: string) {
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${title}`) }).click();
}

test('steps are added, edited, viewed, reordered, turned off and deleted', async ({ page }) => {
  await transform(page);
  await addStep(page, 'Trim whitespace');
  // With no columns selected in the table, it starts on the first text column.
  await expect(steps(page)).toHaveText([/Trimmed name/]);
  const settings = page.getByTestId('step-settings');
  await settings.getByRole('button', { name: 'name', exact: true }).click();
  await expect(settings.getByText('Pick at least one column.')).toBeVisible();
  await settings.getByRole('button', { name: 'name', exact: true }).click();
  await expect(steps(page)).toHaveText([/Trimmed name/]);
  await expect(page.getByTestId('results-title')).toHaveText('Transform 1 · step 1');
  await expect(cell(page, 1, 0)).toHaveText('Ada Lovelace');

  await addStep(page, 'Change case');
  await settings.getByLabel('Case').selectOption('upper');
  await expect(steps(page)).toHaveText([/Trimmed name/, /Changed name to upper case/]);
  await expect(page.getByTestId('results-title')).toHaveText('Transform 1 · step 2');
  await expect(cell(page, 1, 1)).toHaveText('GRACE HOPPER');

  // Viewing step 1 shows the data before the case change.
  await steps(page).nth(0).click();
  await expect(page.getByTestId('results-title')).toHaveText('Transform 1 · step 1');
  await expect(cell(page, 1, 1)).toHaveText('grace hopper');

  // Alt+Down moves the trim after the case change.
  await steps(page).nth(0).press('Alt+ArrowDown');
  await expect(steps(page)).toHaveText([/Changed name to upper case/, /Trimmed name/]);
  await expect(steps(page).nth(1)).toBeFocused();

  // Turning the case change off shows the trimmed but unchanged names.
  await steps(page).nth(0).click();
  await page.getByTestId('step-settings').getByText('Enabled').click();
  await expect(steps(page).nth(0)).toHaveAttribute('aria-disabled', 'true');
  await steps(page).nth(1).click();
  await expect(cell(page, 1, 1)).toHaveText('grace hopper');

  // Delete removes the step from the list, not the node from the canvas; undo brings it back.
  await steps(page).nth(1).press('Delete');
  await expect(steps(page)).toHaveCount(1);
  await expect(node(page, 'Transform 1')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(steps(page)).toHaveCount(2);
});

test('a step renamed by hand keeps its name; nodes take a name and notes', async ({ page }) => {
  await transform(page);
  await addStep(page, 'Remove columns');
  const settings = page.getByTestId('step-settings');
  await settings.getByRole('button', { name: 'email', exact: true }).click();
  await expect(steps(page)).toHaveText([/Removed email/]);
  await settings.getByLabel('Label').fill('Drop contact details');
  await settings.getByLabel('Label').press('Enter');
  await settings.getByRole('button', { name: 'joined', exact: true }).click();
  await expect(steps(page)).toHaveText([/Drop contact details/]);

  await page.getByLabel('Node name').fill('Tidy customers');
  await page.getByLabel('Node name').press('Enter');
  await expect(node(page, 'Tidy customers')).toBeVisible();
  await page.getByLabel('Node notes').fill('Contact details are not shared.');
  await page.getByLabel('Node notes').blur();
  await node(page, 'Tidy customers').click();
  await expect(page.getByLabel('Node notes')).toHaveValue('Contact details are not shared.');
});

test('nodes in a line group into one and ungroup back; a node splits at a step', async ({ page }) => {
  await transform(page);
  await addStep(page, 'Trim whitespace');
  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('menuitem', { name: 'Transform' }).click();
  await node(page, 'Transform 2').click();
  await addStep(page, 'Remove columns');
  await page.getByTestId('step-settings').getByRole('button', { name: 'joined', exact: true }).click();

  // A source can't join a group, and says so.
  await node(page, 'customers.csv').click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('group-bar')).toContainText('Only Transform nodes can be grouped');
  await expect(page.getByRole('button', { name: 'Group into one node' })).toBeDisabled();

  await node(page, 'Transform 1').click();
  await node(page, 'Transform 2').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group into one node' }).click();
  await expect(node(page, 'Transform 2')).toHaveCount(0);
  await expect(steps(page)).toHaveText([/Trimmed name/, /Removed joined/]);
  await expect(page.getByTestId('wire-customers.csv->Transform 1')).toBeAttached();

  await page.getByRole('button', { name: 'Ungroup into the original nodes' }).click();
  await expect(node(page, 'Transform 2')).toBeVisible();
  await expect(page.getByTestId('wire-Transform 1->Transform 2')).toBeAttached();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(node(page, 'Transform 2')).toHaveCount(0);

  // Splitting at the second step gives back the node it came from.
  await node(page, 'Transform 1').click();
  await steps(page).nth(1).click();
  await page.getByRole('button', { name: 'Split node here' }).click();
  await expect(node(page, 'Transform 2')).toBeVisible();
  await expect(page.getByTestId('wire-Transform 1->Transform 2')).toBeAttached();
});
