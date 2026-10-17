// Writes dist-runner/package.json: the one package puddle-run needs at run time that its bundle can't carry, the
// native DuckDB binding, pinned to the version this repository uses. Dockerfile.runner installs from it.
import { readFileSync, writeFileSync } from 'node:fs';

const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const out = {
  name: 'puddle-run',
  private: true,
  version: root.version,
  type: 'module',
  bin: { 'puddle-run': './puddle-run.mjs' },
  dependencies: { '@duckdb/node-api': root.dependencies['@duckdb/node-api'] },
};
writeFileSync(new URL('../dist-runner/package.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
