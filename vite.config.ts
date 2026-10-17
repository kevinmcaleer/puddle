/// <reference types="vitest/config" />
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tokens from './src/design-system/tokens.json';
import { iconSvg, tokenColour, webManifest } from './src/pwa/manifest';
import { precacheList } from './src/pwa/precache';

/** A build id for the service worker: CI passes the commit, local builds use the time. */
const build = process.env.PUDDLE_BUILD ?? Date.now().toString(36);

/** The manifest and icon, and after the build, dist's files (minus what precacheList leaves out) for the service worker to keep. */
function precache(): Plugin {
  let outDir = 'dist';
  return {
    name: 'puddle-precache',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(webManifest(tokens), null, 2) });
      this.emitFile({ type: 'asset', fileName: 'icon.svg', source: iconSvg(tokens) });
    },
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'theme-color', content: tokenColour(tokens, 'surface-panel') }, injectTo: 'head' },
    ],
    closeBundle() {
      const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
      const files = walk(outDir).map((f) => relative(outDir, f).split(sep).join('/'));
      writeFileSync(join(outDir, 'precache.json'), JSON.stringify(precacheList(files)));
    },
  };
}

// Cross-origin isolation (plan D1, D13). The multi-threaded `coi` bundle it unlocks is off for now (see
// src/engine/browser.ts); the headers stay so it can return without a hosting change.
// Production sets the same headers in public/_headers.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/**
 * The isolation headers on every response of the dev and preview servers, 304s included. Vite's own `headers`
 * option leaves them off a 304, and Safari then refuses the DuckDB worker it revalidated, so the engine never
 * starts after a reload.
 */
function isolation(): Plugin {
  const set: Connect.NextHandleFunction = (_req, res, next) => {
    for (const [name, value] of Object.entries(isolationHeaders)) res.setHeader(name, value);
    next();
  };
  return {
    name: 'puddle-isolation',
    configureServer: (server) => void server.middlewares.use(set),
    configurePreviewServer: (server) => void server.middlewares.use(set),
  };
}

/**
 * Test files that set their own environment or mock modules or globals, so they must not share a registry. The
 * IndexedDB ones are here because src/persistence/db.ts keeps its open connection in module state: with a shared
 * registry, one file's fake database (or its lack of one) leaked into the next.
 */
const ISOLATED = [
  'src/canvas/focusNode.test.ts',
  'src/app/selectAll.test.ts',
  'src/compiler/compile.test.ts',
  'src/flow/status.test.ts',
  'src/notes/markdown.test.ts',
  'src/persistence/db.test.ts',
  'src/persistence/workspace.test.ts',
  'src/samples/samples.test.ts',
  'src/sources/handles.test.ts',
  'src/sources/html.test.ts',
  'src/sources/odata.test.ts',
  'src/sources/webpage.test.ts',
  'src/sync/controller.test.ts',
  'src/templates/library.test.ts',
  'src/ui/locale.test.ts',
  'tests/engine/handles.test.ts',
  'tests/engine/samples.test.ts',
];

export default defineConfig({
  plugins: [react(), precache(), isolation()],
  define: { __PUDDLE_BUILD__: JSON.stringify(build) },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  build: {
    target: 'es2022',
    rollupOptions: {
      // The service worker is its own entry, served from the root as sw.js so its scope covers the app.
      input: { main: 'index.html', sw: 'src/pwa/sw.ts' },
      output: { entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    // The quality report inlines the design system's CSS (?raw); without this, tests would see it empty.
    css: { include: [/src\/design-system\/.*\.css/] },
    // Most test files are pure functions and engine runs against DuckDB, so `npm test` runs them with one module
    // registry per worker instead of rebuilding it per file (--no-isolate), which halves the run. Files that need a
    // fresh registry (a jsdom environment, or vi.mock and friends, which change the registry for everything loaded
    // after them) stay isolated: every .tsx test and the .ts tests listed above. Vitest 3.2 only takes `isolate`
    // from the command line in this layout, so package.json runs the two projects one after the other.
    projects: [
      {
        extends: true,
        test: { name: 'isolated', include: ['src/**/*.test.tsx', ...ISOLATED] },
      },
      {
        extends: true,
        test: { name: 'shared', include: ['src/**/*.test.ts', 'tests/**/*.test.ts'], exclude: ['**/node_modules/**', ...ISOLATED] },
      },
    ],
  },
});
