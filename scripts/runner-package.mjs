// Writes dist-runner/package.json: the packages puddle-run needs at run time that its bundle can't carry: the native
// DuckDB binding, pdf.js (which loads its own worker module by path), and the database clients the connection
// sources' drivers load (the same set puddle-connect carries: sql.js, pg, mysql2, node-firebird, tedious, oracledb,
// mongodb, redis, cassandra-driver), pinned to the exact versions this repository's lockfile uses. Dockerfile.runner
// installs from it.
import { readFileSync, writeFileSync } from 'node:fs';

const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// The exact version the lockfile resolved, not the range in package.json: a range would take whatever the registry
// has newest when the image is built, which once asked for a binding that wasn't published yet.
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const pinned = (name) => {
  const v = lock.packages[`node_modules/${name}`]?.version;
  if (!v) throw new Error(`package-lock.json has no ${name}`);
  return v;
};
const out = {
  name: 'puddle-run',
  private: true,
  version: root.version,
  type: 'module',
  bin: { 'puddle-run': './puddle-run.mjs' },
  dependencies: Object.fromEntries(['@duckdb/node-api', 'pdfjs-dist', 'sql.js', 'pg', 'mysql2', 'node-firebird', 'tedious', 'oracledb', 'mongodb', 'redis', 'cassandra-driver'].map((name) => [name, pinned(name)])),
};
writeFileSync(new URL('../dist-runner/package.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
