import { expect, test } from '@playwright/test';
import { addFiles, addStepWithT, expectRows, fixture, node, openApp, saved, selectNode } from './helpers/app';

test('nodes group into one card with their inputs and outputs, open and close, and ungroup', async ({ page }) => {
  await openApp(page);
  await addFiles(page, [fixture('messy.csv')]);
  await expectRows(page, 5);
  await addStepWithT(page, 'Trim whitespace');
  await expect(node(page, 'Transform 1')).toHaveAttribute('data-status', 'ok');
  await page.keyboard.press('o');
  await expect(node(page, 'Output 1')).toHaveAttribute('data-status', 'ok');

  // G groups the selected nodes, as Ctrl+G does in Blender; the card shows what comes in and what goes out.
  await selectNode(page, 'messy.csv');
  await selectNode(page, 'Transform 1', ['Shift']);
  await page.keyboard.press('g');
  const card = page.getByTestId('group-Group 1');
  await expect(card).toBeVisible();
  await expect(node(page, 'Transform 1')).toHaveCount(0);
  await expect(card).toHaveAttribute('data-outputs', 'Transform 1');
  await expect(card).toHaveAttribute('data-inputs', '0');
  await expect(page.getByTestId('wire-Transform 1->Output 1')).toBeAttached();
  await expect.poll(async () => (await saved(page)) as unknown as { groups: { name: string; collapsed: boolean }[] }).toMatchObject({ groups: [{ name: 'Group 1', collapsed: true }] });

  // A result's name on the card views it.
  await card.getByRole('button', { name: 'Transform 1' }).click();
  await expect(page.getByTestId('results-title')).toHaveText('Transform 1');

  // Renamed from its right-click menu.
  await card.click({ button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Rename group…' }).click();
  await page.getByRole('dialog', { name: 'Rename group' }).getByLabel('Name').fill('Clean messy');
  await page.getByRole('dialog', { name: 'Rename group' }).getByRole('button', { name: 'Rename' }).click();
  const renamed = page.getByTestId('group-Clean messy');
  await expect(renamed).toBeVisible();

  // A double click opens it as a frame round its nodes; the frame's button closes it again.
  await renamed.dblclick();
  await expect(page.getByTestId('frame-Clean messy')).toBeVisible();
  await expect(node(page, 'Transform 1')).toBeVisible();
  await page.getByRole('button', { name: 'Close Clean messy' }).click();
  await expect(renamed).toBeVisible();
  await expect(node(page, 'Transform 1')).toHaveCount(0);

  // Ungrouped, the nodes are back as they were.
  await renamed.click({ button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Ungroup' }).click();
  await expect(renamed).toHaveCount(0);
  await expect(node(page, 'Transform 1')).toBeVisible();
  await expect(page.getByTestId('wire-messy.csv->Transform 1')).toBeAttached();
});
