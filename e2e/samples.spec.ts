import { expect, test, type Page } from '@playwright/test';
import { cell, expectRows, node, openApp } from './helpers/app';

const projectMenu = async (page: Page, item: string) => {
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: item }).click();
};

test('a sample opens from the empty canvas as a new project, with its data and its note', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Try a sample' }).click();
  const dialog = page.getByRole('dialog', { name: 'Try a sample' });
  await expect(dialog.getByRole('listitem')).toHaveCount(4);
  await dialog.getByTestId('sample-contacts').click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('project-name')).toHaveText('Sample: contact list');
  await expect(node(page, 'contacts.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'contacts.csv')).toContainText('Sample · CSV');
  await expectRows(page, 53);
  await expect(cell(page, 0, 0)).toContainText('alice patel');
  await expect(page.getByTestId('notes-preview')).toContainText('What’s wrong with it');
  await expect(page.getByTestId('notes-preview')).toContainText('five contacts appear twice');

  // A reload reads the sample again, with no file to choose.
  await page.reload();
  await expect(node(page, 'contacts.csv')).toHaveAttribute('data-status', 'ok', { timeout: 45_000 });
  await expectRows(page, 53);
  await node(page, 'contacts.csv').click();
  await expect(page.getByTestId('url-panel')).toHaveAttribute('data-state', 'ok');
  await expect(page.getByRole('region', { name: 'Sample data' })).toBeVisible();
});

test('the home screen offers the samples; a sample is listed and deleted like any project', async ({ page }) => {
  await openApp(page);
  await projectMenu(page, 'All projects');
  const samples = page.getByTestId('home-samples');
  await expect(samples.getByRole('listitem')).toHaveCount(4);
  await samples.getByTestId('sample-orders').click();

  await expect(page.getByTestId('project-name')).toHaveText('Sample: orders and customers');
  await expect(node(page, 'orders.csv')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await expect(node(page, 'customers.csv')).toHaveAttribute('data-status', 'ok');
  await expectRows(page, 60);

  await projectMenu(page, 'All projects');
  await expect(page.getByTestId('project-Sample: orders and customers')).toContainText('2 sources · 2 nodes');
  await page.getByRole('button', { name: 'More for Sample: orders and customers' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete project?' }).getByRole('button', { name: 'Delete project' }).click();
  await expect(page.getByTestId('project-Sample: orders and customers')).toHaveCount(0);
  await expect(samples.getByTestId('sample-orders')).toBeVisible();
});
