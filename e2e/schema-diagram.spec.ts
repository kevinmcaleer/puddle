import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openApp } from './helpers/app';

const DIAGRAM = readFileSync('tests/fixtures/dbml/diagram.dbml', 'utf8');

const openSchema = async (page: Page) => {
  await page.getByTestId('project-menu').click();
  await page.getByRole('menuitem', { name: 'Schema' }).click();
  await expect(page.getByTestId('schema-view')).toBeVisible();
};

const centre = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test('the schema diagram draws groups, enums, composite refs and notes, highlights a hovered table, finds a table and auto-arranges', async ({ page }) => {
  await openApp(page);
  await openSchema(page);
  await page.getByRole('combobox', { name: 'DBML' }).fill(DIAGRAM);

  // Everything DBML can say is drawn: the group frame, the enum and its link, the composite ref once, the sticky note.
  await expect(page.getByTestId('schema-group-billing')).toBeVisible();
  await expect(page.getByTestId('schema-enum-job_status')).toContainText('running');
  await expect(page.getByTestId('schema-link-job_status-jobs.status')).toBeAttached();
  await expect(page.getByTestId('schema-ref-merchant_periods-merchants')).toHaveCount(1);
  await expect(page.getByTestId('schema-ref-merchant_periods-merchants')).toHaveAttribute('data-pairs', 'merchant_id=id,country_code=country_code');
  await expect(page.getByTestId('schema-note-planning')).toContainText('Jobs run every hour');

  // Hovering a column shows its settings; hovering a table lights its refs and dims the rest.
  await page.getByTestId('schema-col-jobs-status').hover();
  await expect(page.getByTestId('schema-popover')).toContainText('Where the job is up to');
  await expect(page.getByTestId('schema-popover')).toContainText('created, running, done');
  await expect(page.getByTestId('schema-ref-jobs-merchants')).toHaveClass(/is-current/);
  await expect(page.getByTestId('schema-ref-merchant_periods-merchants')).toHaveClass(/is-dim/);
  await expect(page.getByTestId('schema-table-merchant_periods')).toHaveClass(/is-dim/);
  await expect(page.getByTestId('schema-table-users')).not.toHaveClass(/is-dim/);

  // The search box centres the table typed.
  await page.getByTestId('schema-search').fill('users');
  // The drawing area, below the views strip.
  const pane = page.getByTestId('schema-diagram');
  await expect(page.getByTestId('schema-table-users')).toHaveClass(/is-found/);
  await expect
    .poll(async () => {
      const [a, b] = [await centre(page.getByTestId('schema-table-users')), await centre(pane)];
      return Math.round(Math.hypot(a.x - b.x, a.y - b.y));
    })
    .toBeLessThan(4);

  // Auto-arrange lays it out with nothing overlapping, and fits it in the pane.
  await page.getByRole('button', { name: 'Auto-arrange' }).click();
  const tables = ['merchants', 'merchant_periods', 'jobs', 'users'];
  await expect
    .poll(async () => {
      const boxes = await Promise.all([...tables.map((t) => page.getByTestId(`schema-table-${t}`)), page.getByTestId('schema-enum-job_status')].map((l) => l.boundingBox()));
      let overlaps = 0;
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, b] = [boxes[i]!, boxes[j]!];
          if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) overlaps++;
        }
      return overlaps;
    })
    .toBe(0);
  const area = (await pane.boundingBox())!;
  for (const t of tables) {
    const b = (await page.getByTestId(`schema-table-${t}`).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(area.x);
    expect(b.x + b.width).toBeLessThanOrEqual(area.x + area.width);
  }

  // Zoom from the toolbar and back to 100% with the keyboard.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const zoom = await page.getByTestId('schema-diagram').getAttribute('data-zoom');
  await page.getByTestId('schema-diagram').focus();
  await page.keyboard.press('0');
  await expect(page.getByTestId('schema-diagram')).toHaveAttribute('data-zoom', '100');
  expect(Number(zoom)).not.toBe(100);
});
