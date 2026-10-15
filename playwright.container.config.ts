import { defineConfig, devices } from '@playwright/test';

// Tests against a running Puddle container (see deploy/README.md): headers, self-hosted extensions, offline.
// PUDDLE_URL defaults to the port CI and the docs use.
export default defineConfig({
  testDir: './e2e/container',
  timeout: 120_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: process.env.PUDDLE_URL ?? 'http://localhost:8088', trace: 'retain-on-failure', serviceWorkers: 'allow' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
