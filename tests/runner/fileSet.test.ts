// puddle-run with a file set and a SQL script, as on the Pi: a folder of Parquet extracts read by a script that makes
// log, users and docs (tests/fixtures/doclog, written to Parquet here by DuckDB's native build).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, type RunnerDb } from '../../src/runner/db';
import { runProject } from '../../src/runner/run';
import { checkLines } from '../../src/runner/cli';
import { listedFileSet, placeFileSet } from '../../src/runner/sources';
import { listFolder } from '../../src/runner/folder';
import type { Source } from '../../src/model';
import { flow, src } from '../helpers/projects';

const fixtures = join(__dirname, '../fixtures/doclog');
// Kev's script, as written for DuckDB: every Parquet file of the folder, and the users file by name.
const SCRIPT = `CREATE OR REPLACE TABLE log AS
SELECT DISTINCT
"Document ID" AS docid,
"Document Log id" AS log_id,
"User Name" AS user_name,
"Option Execute Cancelled" AS option_execute_cancelled
FROM read_parquet('*.parquet', union_by_name = true)
WHERE "Document ID" IS NOT NULL;

CREATE OR REPLACE TABLE users AS
SELECT * FROM read_parquet('sap_users.parquet');

CREATE OR REPLACE TABLE docs AS
SELECT l.docid,
COUNT() AS all_steps,
COUNT(*) FILTER (WHERE COALESCE(l.option_execute_cancelled,'') <> 'X'
AND u."User Type" = 'A Dialog') AS human_steps
FROM log l
LEFT JOIN users u ON upper(trim(u."User Name")) = upper(trim(l.user_name))
GROUP BY l.docid
ORDER BY l.docid;`;

let folder: string;
let db: RunnerDb;
beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'puddle-fileset-'));
  mkdirSync(join(folder, 'extract'));
  db = await openDb();
  for (const name of ['log-2024-01', 'log-2024-02', 'sap_users']) {
    const csv = join(folder, `${name}.csv`);
    writeFileSync(csv, readFileSync(join(fixtures, `${name}.csv`)));
    await db.query(`COPY (SELECT * FROM read_csv('${csv}', all_varchar = true)) TO '${join(folder, 'extract', `${name}.parquet`)}' (FORMAT parquet)`);
  }
  writeFileSync(join(folder, 'extract', '.DS_Store'), 'x');
});
afterAll(async () => {
  await db.close();
  rmSync(folder, { recursive: true, force: true });
});

const chosen = (names: string[]) => names.map((name) => ({ name, size: 1, lastModified: 1 }));
const logs = (fileSet: Partial<NonNullable<Source['fileSet']>> = {}): Source => src({ id: 'logs', kind: 'files', format: 'parquet', fileSet: { files: chosen(['log-2024-01.parquet', 'sap_users.parquet']), folder: 'extract', ...fileSet } });

const project = (source: Source) =>
  flow({
    sources: [source],
    nodes: [
      { id: 'logs', type: 'source', sourceId: 'logs' },
      { id: 'script', type: 'sql', sqlSpec: { query: SCRIPT } },
      { id: 'log', type: 'scriptTable', scriptTable: { table: 'log' } },
      { id: 'docs', type: 'output', outputSpec: { format: 'csv', options: {} } },
      { id: 'log-out', type: 'output', outputSpec: { format: 'csv', options: {} } },
    ],
    wires: [
      ['logs', 'script', 0],
      ['script', 'log'],
      ['script', 'docs'],
      ['log', 'log-out'],
    ],
  });

describe('a file set on the runner', () => {
  it('reads the folder’s files its pattern matches, or the ones chosen in the browser, never hidden files', () => {
    const files = listFolder(join(folder, 'extract'));
    expect(files.map((f) => f.name).sort()).toEqual(['.DS_Store', 'log-2024-01.parquet', 'log-2024-02.parquet', 'sap_users.parquet']);
    expect(listedFileSet(logs(), files).fileSet!.files.map((f) => f.name)).toEqual(['log-2024-01.parquet', 'sap_users.parquet']);
    expect(listedFileSet(logs({ pattern: '*' }), files).fileSet!.files.map((f) => f.name)).toEqual(['log-2024-01.parquet', 'log-2024-02.parquet', 'sap_users.parquet']);
  });

  it('finds the folder it was chosen as beside the project file, or says where it looked', () => {
    expect(placeFileSet(logs(), folder, () => true, listFolder)).toMatchObject({ dir: join(folder, 'extract') });
    expect(placeFileSet(logs({ path: 'elsewhere' }), folder, () => false, listFolder)).toEqual({ reason: `found none of its files in ${join(folder, 'elsewhere')}` });
  });

  it('runs a script over every Parquet file in the folder, writing its tables', async () => {
    const outDir = join(folder, 'out');
    const { log } = await runProject(project(logs({ pattern: '*.parquet' })), { folder, outDir, db });
    expect(log.outputs.map((o) => [o.nodeId, o.status, o.rows])).toEqual([
      ['docs', 'written', 2],
      ['log-out', 'written', 5],
    ]);
    expect(readFileSync(join(outDir, 'docs.csv'), 'utf8').trim().split('\n')).toEqual(['docid,all_steps,human_steps', 'D1,3,3', 'D2,2,0']);
  });

  it('says how many files it found in check', () => {
    const { lines } = checkLines(project(logs({ pattern: '*.parquet' })), folder, () => true, { secretOf: () => undefined, served: new Set(), env: {} });
    expect(lines).toContain(`  source logs: 3 files in ${join(folder, 'extract')}`);
  });
});
