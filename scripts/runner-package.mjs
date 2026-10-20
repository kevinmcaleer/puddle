// Writes dist-runner/package.json: the one package puddle-run needs at run time that its bundle can't carry, the
// native DuckDB binding, pinned to the exact version this repository's lockfile uses. Dockerfile.runner installs from it.
import { readFileSync, writeFileSync } from 'node:fs';

const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// The exact version the lockfile resolved, not the range in package.json: a range would take whatever the registry
// has newest when the image is built, which once asked for a binding that wasn't published yet.
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const duckdb = lock.packages['node_modules/@duckdb/node-api']?.version;
if (!duckdb) throw new Error('package-lock.json has no @duckdb/node-api');
const out = {
  name: 'puddle-run',
  private: true,
  version: root.version,
  type: 'module',
  bin: { 'puddle-run': './puddle-run.mjs' },
  dependencies: { '@duckdb/node-api': duckdb },
};
writeFileSync(new URL('../dist-runner/package.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
