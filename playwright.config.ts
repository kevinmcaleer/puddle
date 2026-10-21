import { defineConfig } from '@playwright/test';
import { browserProjects } from './e2e/helpers/browsers';
import { E2E_GOOGLE_CLIENT_ID } from './e2e/helpers/drive';

// E2E_PORT lets several checkouts run the suite side by side without reusing each other's server.
const port = Number(process.env.E2E_PORT ?? 4173);
// puddle-connect's port is fixed: the app looks for it at localhost:8765.
const connectPort = 8765;

export default defineConfig({
  testDir: './e2e',
  // The container tests run against a built image: npm run e2e:container.
  testIgnore: 'container/**',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ...(process.env.CI ? [['github'] as const] : []),
    ['list'] as const,
    // With E2E_BROWSER_LOGS (CI), each failure also prints what the page showed.
    ...(process.env.E2E_BROWSER_LOGS ? [['./e2e/helpers/failure-context.ts'] as const] : []),
  ],
  // The service worker would precache the 36 MB engine in every test; e2e/container tests it.
  // Numbers and dates are shown in the browser's locale, so it's fixed here rather than taken from the machine.
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure', serviceWorkers: 'block', locale: 'en-GB' },
  projects: browserProjects(),
  webServer: [
    {
      // vite build alone: the typecheck that `npm run build` adds is its own CI step and its own script.
      command: `npx vite build && npx vite preview --port ${port} --strictPort`,
      // A test-only Google client ID, so the Google Drive option shows (against a mocked Google). The default build has
      // none and hides it; src/home/HomeScreen.test.tsx covers that.
      env: { VITE_GOOGLE_CLIENT_ID: E2E_GOOGLE_CLIENT_ID },
      port,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // puddle-connect on this computer, as a user would start it, for the "On this computer" flow; it may read the
      // database fixtures only.
      command: `npm run build:connect && node dist-connect/puddle-connect.mjs --port ${connectPort} --origin http://localhost:${port}`,
      env: { PUDDLE_CONNECT_FILES: `${process.cwd()}/tests/fixtures/db` },
      port: connectPort,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
