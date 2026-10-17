// What the service worker keeps for offline use, and how it answers each request. Shared by the build
// (vite.config.ts writes precache.json) and the worker (src/pwa/sw.ts).

export const CACHE_PREFIX = 'puddle-';
export const cacheName = (build: string) => `${CACHE_PREFIX}${build}`;

/** Files never worth keeping offline: source maps, the worker itself, host config, and the mvp bundle (old browsers fetch it when they need it). */
const SKIP = [/\.map$/, /^sw\.js$/, /^precache\.json$/, /^_headers$/, /duckdb-mvp/, /duckdb-browser-mvp/, /\/wasm_mvp\//, /^duckdb-extensions\/manifest\.json$/];

/** The precache list for a build, from its output files (paths relative to the site root, with / separators). */
export function precacheList(files: string[]): string[] {
  const keep = files.filter((f) => !SKIP.some((re) => re.test(f)));
  return [...new Set(['./', ...keep])].sort();
}

/**
 * Paths beside the app that aren't part of it: the user guide (its own site, read online) and the taxi tutorial's
 * files, passed through from the TLC (large, and read in parts, which the Cache API can't keep).
 */
const NOT_THE_APP = ['/docs/', '/tutorial-data/'];

/** How the worker answers a request: pages go to the network first so a new deploy shows; everything else is versioned and comes from the cache first. */
export function strategyFor(url: URL, origin: string, mode: RequestMode | string): 'page' | 'cache-first' | 'network' {
  if (url.origin !== origin) return 'network';
  if (NOT_THE_APP.some((p) => url.pathname.startsWith(p))) return 'network';
  if (mode === 'navigate') return 'page';
  if (url.pathname.endsWith('/duckdb-extensions/manifest.json')) return 'network';
  return 'cache-first';
}
