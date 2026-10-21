import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addFiles, expectRows, node, openApp, selectNode } from './helpers/app';

interface Engine {
  info: { bundle: string; crossOriginIsolated: boolean };
  query(sql: string, opts?: object): Promise<{ numRows: number }>;
  registerText(name: string, text: string): Promise<void>;
}
declare global {
  var __puddle: { engine: Engine } | undefined;
}

test('DuckDB-WASM starts in a worker on the eh bundle, even when isolated', async ({ page }) => {
  await page.goto('/');
  const ready = page.getByTestId('engine-ready');
  await expect(ready).toBeVisible({ timeout: 45_000 });
  const info = await page.evaluate(() => globalThis.__puddle!.engine.info);
  expect(info.crossOriginIsolated).toBe(true);
  // The coi bundle can't read large chosen files; see the parallel-scan test below.
  expect(info.bundle).toBe('eh');
  await expect(ready).toHaveAttribute('data-bundle', 'eh');
});

test('queries run, and a superseded preview never returns its result', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('engine-ready')).toBeVisible({ timeout: 45_000 });
  const outcome = await page.evaluate(async () => {
    const engine = globalThis.__puddle!.engine;
    await engine.registerText('t.csv', 'id,name\n1,Ada\n2,Grace\n3,Edsger\n');
    const ok = await engine.query("SELECT * FROM read_csv('t.csv')");
    const slow = engine.query('SELECT count(*) FROM range(300000000) a, range(10) b', { supersede: 'preview' }).then(
      () => 'resolved',
      (e: { code?: string }) => e.code,
    );
    const fast = engine.query('SELECT 42 AS answer', { supersede: 'preview' });
    return { rows: ok.numRows, slow: await slow, fast: (await fast).numRows };
  });
  expect(outcome).toEqual({ rows: 3, slow: 'cancelled', fast: 1 });
});

// Regression: in the multi-threaded coi bundle, DuckDB's worker threads never received chosen files, so any
// file big enough to be scanned in parallel failed ("No HTML5 file registered") on counts, rules and exports.
test('a file big enough to be scanned in parallel is read in full', async ({ page }) => {
  test.setTimeout(180_000);
  const rows = 1_200_000;
  const dir = mkdtempSync(join(tmpdir(), 'puddle-large-'));
  const path = join(dir, 'large.csv');
  const out = ['id,name,email,amount'];
  for (let i = 0; i < rows; i++) out.push(`${i},Customer number ${i} with a longish name,user${i}@example.com,${(i * 1.37).toFixed(2)}`);
  writeFileSync(path, out.join('\n') + '\n');
  try {
    await openApp(page);
    await addFiles(page, [path]);
    await expect(node(page, 'large.csv')).toHaveAttribute('data-status', 'ok', { timeout: 60_000 });
    await selectNode(page, 'large.csv');
    await expectRows(page, rows);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
