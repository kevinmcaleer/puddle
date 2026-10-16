import { defineConfig } from '@playwright/test';
import { browserProjects } from './e2e/helpers/browsers';

// E2E_PORT lets several checkouts run the suite side by side without reusing each other's server.
const port = Number(process.env.E2E_PORT ?? 4173);

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
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure', serviceWorkers: 'block' },
  projects: browserProjects(),
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
