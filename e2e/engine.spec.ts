import { expect, test } from '@playwright/test';

interface Engine {
  info: { bundle: string; crossOriginIsolated: boolean };
  query(sql: string, opts?: object): Promise<{ numRows: number }>;
  registerText(name: string, text: string): Promise<void>;
}
declare global {
  var __puddle: { engine: Engine } | undefined;
}

test('DuckDB-WASM starts in a worker and picks the coi bundle when isolated', async ({ page }) => {
  await page.goto('/');
  const ready = page.getByTestId('engine-ready');
  await expect(ready).toBeVisible({ timeout: 45_000 });
  const info = await page.evaluate(() => globalThis.__puddle!.engine.info);
  expect(info.crossOriginIsolated).toBe(true);
  expect(info.bundle).toBe('coi');
  await expect(ready).toHaveAttribute('data-bundle', 'coi');
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
