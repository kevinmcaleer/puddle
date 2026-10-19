// puddle-run schema as a built command: the CLI bundled as the release bundles it, run with Node on fixture files.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportSql } from '../../src/compiler/ddl/export';
import { createProject, setSchemaDbml } from '../../src/model';
import { EXAMPLE_DBML } from '../../src/schema/example';
import { defaultDocsTokens, writeDocsHtml } from '../../src/schema/docs';
import { parseDbml } from '../../src/schema/parse';

const root = join(__dirname, '../..');
let folder: string;
let cli: string;
beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'puddle-schema-'));
  // Beside the repository's node_modules, so the native DuckDB binding the bundle leaves out is found.
  cli = join(root, 'node_modules', '.cache', `puddle-run-schema-${process.pid}.mjs`);
  await build({ entryPoints: [join(root, 'src/runner/cli.ts')], bundle: true, platform: 'node', target: 'node20', format: 'esm', external: ['@duckdb/node-api'], outfile: cli, logLevel: 'warning' });
  writeFileSync(join(folder, 'docs.puddle.json'), JSON.stringify(setSchemaDbml(createProject('Docs example'), EXAMPLE_DBML)));
  writeFileSync(join(folder, 'broken.dbml'), 'Table a {\n  id int [pk\n}\n');
}, 60_000);
afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
  rmSync(cli, { force: true });
});

const puddleRun = (...args: string[]) => spawnSync(process.execPath, [cli, 'schema', ...args], { cwd: folder, encoding: 'utf8' });

describe('puddle-run schema, built', () => {
  it('--check exits 0 on the docs example and 1 on a broken DBML', () => {
    expect(puddleRun('docs.puddle.json', '--check').status).toBe(0);
    const broken = puddleRun('broken.dbml', '--check');
    expect(broken.status).toBe(1);
    expect(broken.stderr).toMatch(/^broken\.dbml:3:1: /);
  });

  it('--ddl postgres writes the script the app exports, and --docs the app’s page without diagrams', () => {
    const r = puddleRun('docs.puddle.json', '--ddl', 'postgres', 'schema.sql', '--docs', 'schema.html');
    expect(r.status).toBe(0);
    const schema = parseDbml(EXAMPLE_DBML).schema;
    expect(readFileSync(join(folder, 'schema.sql'), 'utf8')).toBe(exportSql(schema, 'postgres').sql);
    expect(readFileSync(join(folder, 'schema.html'), 'utf8')).toBe(writeDocsHtml(schema, { title: 'Docs example', views: [], tokens: defaultDocsTokens() }));
  });

  it('prints its usage, and exits 2 on arguments it doesn’t know', () => {
    expect(execFileSync(process.execPath, [cli, 'help'], { encoding: 'utf8' })).toContain('puddle-run schema <project.puddle.json | schema.dbml>');
    expect(puddleRun('docs.puddle.json', '--nope').status).toBe(2);
  });
});
