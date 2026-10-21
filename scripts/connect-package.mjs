// Writes dist-connect/package.json: what puddle-connect needs beside its bundle (sql.js, whose WASM is found next to
// its own module, so it isn't bundled; pg, which loads optional native parts by name), pinned to the versions this repository's lockfile resolved, and the bin that
// makes `npx puddle-connect` work. Dockerfile.connect installs from it.
import { readFileSync, writeFileSync } from 'node:fs';

const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const pinned = (name) => {
  const v = lock.packages[`node_modules/${name}`]?.version;
  if (!v) throw new Error(`package-lock.json has no ${name}`);
  return v;
};
const out = {
  name: 'puddle-connect',
  private: true,
  version: root.version,
  type: 'module',
  bin: { 'puddle-connect': './puddle-connect.mjs' },
  dependencies: { 'sql.js': pinned('sql.js'), pg: pinned('pg') },
};
writeFileSync(new URL('../dist-connect/package.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
