import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const fixture = (name: string) => join(import.meta.dirname, '../../tests/fixtures', name);
export const fixtureText = (name: string) => readFileSync(fixture(name), 'utf8');

/** Open the app and wait for DuckDB, which every data flow needs. */
export async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
}

/** Add files through the toolbar's Add source menu and the system file chooser. */
export async function addFiles(page: Page, files: string[] | { name: string; mimeType: string; buffer: Buffer }[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add source' }).first().click();
  await page.getByRole('menuitem', { name: /Choose files/ }).click();
  await (await chooser).setFiles(files);
}

export const node = (page: Page, name: string) => page.getByTestId(`node-${name}`);

/** The rows the results table says it has, once the background count lands. */
export async function expectRows(page: Page, rows: number) {
  await expect(page.getByTestId('results-table')).toHaveAttribute('data-rows', String(rows), { timeout: 20_000 });
}

/** Read the viewed result's first rows the way the grid gets them, through the store and engine. */
export async function columnsOf(page: Page, nodeName: string): Promise<string[]> {
  await expect(node(page, nodeName)).toHaveAttribute('data-status', 'ok', { timeout: 20_000 });
  await node(page, nodeName).click();
  return page.getByTestId('inspector-columns').locator('.ui-col').allTextContents();
}

/** A visible results cell by data column and row (both from 0), as Glide mirrors it for screen readers. */
export const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);
