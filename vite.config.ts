/// <reference types="vitest/config" />
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
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

export default defineConfig({
  plugins: [react(), precache()],
  define: { __PUDDLE_BUILD__: JSON.stringify(build) },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
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
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
  },
});
