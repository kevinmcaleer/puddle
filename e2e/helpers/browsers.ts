import { devices, type Project } from '@playwright/test';

// The browsers Puddle supports. E2E_BROWSERS picks some of them (comma separated); the default is Chromium
// alone, the browser the dev container ships. CI runs each browser in its own job.
const all: Record<string, Project> = {
  chromium: { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  firefox: { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  webkit: { name: 'webkit', use: { ...devices['Desktop Safari'] } },
};

export function browserProjects(): Project[] {
  const names = (process.env.E2E_BROWSERS ?? 'chromium')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  return names.map((n) => {
    const project = all[n];
    if (!project) throw new Error(`E2E_BROWSERS: unknown browser ${n}. Use chromium, firefox or webkit.`);
    return project;
  });
}
