// Bundles puddle-run (src/runner/cli.ts) with esbuild. The options live here so tests/runner/schema.test.ts builds
// the same bundle it runs: the native DuckDB binding and pdf.js stay outside it, the design system's CSS goes in as
// text for the HTML quality report, JSX uses the automatic runtime, and CommonJS packages (react-dom/server) get the `require` an ES module lacks.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

export const runnerBuildOptions = {
  entryPoints: ['src/runner/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['@duckdb/node-api', 'pdfjs-dist'],
  loader: { '.css': 'text' },
  // The report document is JSX: compiled to the automatic runtime, as Vite builds it, so no React global is needed.
  jsx: 'automatic',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  outfile: 'dist-runner/puddle-run.mjs',
  logLevel: 'warning',
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await build(runnerBuildOptions);
