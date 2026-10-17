import { defineConfig } from '@playwright/test';

// Captures the documentation's screenshots: npm run docs:screenshots. It drives a production build the way the e2e
// suite does, in Chromium only, at one fixed window size, locale and colour scheme so the pictures stay alike.
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './screenshots',
  timeout: 120_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [...(process.env.CI ? [['github'] as const] : []), ['list'] as const],
  use: {
    baseURL: `http://localhost:${port}`,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  outputDir: '../test-results/docs',
  webServer: {
    command: `npx vite build && npx vite preview --port ${port} --strictPort`,
    cwd: '..',
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
