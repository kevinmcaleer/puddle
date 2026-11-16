// SQL scripts and file sets on real DuckDB-WASM (Node build): a script over a set of log files, as in a SAP workflow
// extract, creates log, users and docs, each table reading the ones before it (tests/fixtures/doclog).
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { compile, fileSetFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { evaluateFlow, invalidateCaches, useFlowStore } from '../../src/flow/status';
import type { FileSetFile, Source } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

const dir = join(__dirname, '../fixtures/doclog');
const file = (name: string): FileSetFile => ({ name, size: statSync(join(dir, name)).size, lastModified: 1 });
const files = ['log-2024-01.csv', 'log-2024-02.csv', 'sap_users.csv'].map(file);
const set = (fileSet: Partial<NonNullable<Source['fileSet']>> = {}): Source => src({ id: 'logs', kind: 'files', format: 'csv', fileSet: { files, ...fileSet } });

const SCRIPT = `CREATE OR REPLACE TABLE log AS
SELECT DISTINCT
"Document ID" AS docid,
"Document Log id" AS log_id,
"User Name" AS user_name,
"Actual Start Date of Process" AS act_start_date,
"Option Execute Cancelled" AS option_execute_cancelled
FROM read_csv('*.csv', union_by_name = true)
WHERE "Document ID" IS NOT NULL;

-- The users come from one file of the set.
CREATE OR REPLACE TABLE users AS
SELECT * FROM read_csv('sap_users.csv');

CREATE OR REPLACE TABLE docs AS
SELECT l.docid,
MIN(l.act_start_date) AS first_step,
MAX(l.act_start_date) AS last_step,
COUNT() AS all_steps,
COUNT() FILTER (WHERE COALESCE(l.option_execute_cancelled,'') <> 'X') AS executed_steps,
COUNT(*) FILTER (WHERE COALESCE(l.option_execute_cancelled,'') <> 'X'
AND u."User Type" = 'A Dialog') AS human_steps
FROM log l
LEFT JOIN users u ON upper(trim(u."User Name")) = upper(trim(l.user_name))
GROUP BY l.docid
ORDER BY l.docid;`;

const project = (query: string, source = set()) =>
  flow({
    sources: [source],
    nodes: [
      { id: 'logs', type: 'source', sourceId: source.id },
      { id: 'script', type: 'sql', sqlSpec: { query } },
      { id: 'log', type: 'scriptTable', scriptTable: { table: 'log' } },
      { id: 'users', type: 'scriptTable', scriptTable: { table: 'Users' } },
    ],
    wires: [
      ['logs', 'script', 0],
      ['script', 'log'],
      ['script', 'users'],
    ],
  });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  for (const f of files) await engine.registerBuffer(fileSetFileName('logs', f), new Uint8Array(readFileSync(join(dir, f.name))));
});
afterAll(() => engine.close());

const rows = async (query: string, nodeId: string, source?: Source) => tableRows((await engine.query(compile(project(query, source), { nodeId }).sql)).table).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));

describe('a SQL script', () => {
  it('makes each table from the files and the tables before it; the node’s rows are the last table', async () => {
    const docs = await rows(SCRIPT, 'script');
    expect(docs.map((d) => [d.docid, d.all_steps, d.executed_steps, d.human_steps])).toEqual([
      ['D1', 3, 3, 3],
      ['D2', 2, 1, 0],
    ]);
  });

  it('gives each table to its script table node', async () => {
    expect(await rows(SCRIPT, 'log')).toHaveLength(5);
    expect((await rows(SCRIPT, 'users')).map((u) => u['User Name'])).toEqual(['ALICE', 'BOB', 'BATCH01']);
  });

  it('reads a file named in place of a table', async () => {
    expect(await rows(`SELECT count(*) AS n FROM 'sap_users.csv'`, 'script')).toEqual([{ n: 3 }]);
  });

  it('reads only the files of the set its pattern keeps', async () => {
    const only = set({ pattern: 'log-*.csv' });
    expect(await rows(`SELECT count(*) AS n FROM read_csv('*.csv', union_by_name = true)`, 'script', only)).toEqual([{ n: 7 }]);
  });
});

describe('a script outside a wired SQL node', () => {
  const run = async (p: ReturnType<typeof flow>, nodeId: string) => tableRows((await engine.query(compile(p, { nodeId }).sql)).table).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));

  it('runs as a Query’s SQL: the table it creates goes to its node, the last statement to the Query', async () => {
    const source = set();
    const p = flow({
      sources: [source],
      nodes: [
        { id: 'logs', type: 'source', sourceId: source.id, name: 'logs' },
        { id: 'q', type: 'query', querySpec: { sql: `CREATE OR REPLACE TABLE cancelled AS (SELECT "Document ID" AS docid FROM logs WHERE "Option Execute Cancelled" = 'X');\nSELECT count(*) AS n FROM cancelled` } },
        { id: 't', type: 'scriptTable', scriptTable: { table: 'cancelled' } },
      ],
      wires: [
        ['logs', 'q', 0],
        ['q', 't'],
      ],
    });
    expect(await run(p, 't')).toEqual([{ docid: 'D2' }]);
    expect(await run(p, 'q')).toEqual([{ n: 1 }]);
  });

  it('runs in a SQL node with nothing wired in, when it makes its rows itself', async () => {
    const p = flow({
      nodes: [
        { id: 'q', type: 'sql', sqlSpec: { query: `CREATE OR REPLACE TABLE sizes AS\nSELECT *\nFROM (VALUES (1, 'first'), (2, 'second')) AS t(id, name)` } },
        { id: 't', type: 'scriptTable', scriptTable: { table: 'sizes' } },
      ],
      wires: [['q', 't']],
    });
    const made = [
      { id: 1, name: 'first' },
      { id: 2, name: 'second' },
    ];
    expect(await run(p, 't')).toEqual(made);
    expect(await run(p, 'q')).toEqual(made);
    const plain = flow({ nodes: [{ id: 'q', type: 'sql', sqlSpec: { query: 'SELECT range AS n FROM range(3)' } }] });
    expect(await run(plain, 'q')).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }]);
  });
});

describe('a file set', () => {
  it('reads its files as one table, columns lined up by name', async () => {
    const all = tableRows((await engine.query(compile(project('SELECT 1'), { nodeId: 'logs' }).sql)).table);
    expect(all).toHaveLength(10);
    expect(Object.keys(all[0]!)).toEqual(expect.arrayContaining(['Document ID', 'Comments Exist', 'User Type']));
  });

  it('names each row’s file when asked', async () => {
    const only = set({ pattern: 'log-*', fileColumn: true });
    const all = tableRows((await engine.query(compile(project('SELECT 1', only), { nodeId: 'logs' }).sql)).table);
    expect(new Set(all.map((r) => r.file))).toEqual(new Set(['log-2024-01.csv', 'log-2024-02.csv']));
    expect(Object.keys(all[0]!)).not.toContain('__puddle_file');
  });
});

describe('a script DuckDB refuses', () => {
  // Kev's: FILTER written as a function. DuckDB counts the lines of everything Puddle sends; the message counts his.
  const BAD = `CREATE OR REPLACE TABLE log AS
SELECT "Document ID" AS docid, "User Name" AS po_number
FROM read_csv('*.csv', union_by_name = true);

CREATE OR REPLACE TABLE doc_po AS
SELECT docid,
FILTER ((WHERE nullif(trim(po_number),'') IS NOT NULL), '0') AS po_number
FROM log
GROUP BY docid;`;

  it('says which line of the script, in the script’s own line numbers', async () => {
    invalidateCaches();
    await evaluateFlow(engine, project(BAD));
    const status = useFlowStore.getState().nodes.script!.status;
    expect(status).toMatchObject({ state: 'error' });
    expect(status.state === 'error' && status.message).toBe(
      `The SQL couldn't be read: syntax error at or near "WHERE". Check the expression for typos. Line 7: FILTER ((WHERE nullif(trim(po_number),'') IS NOT NULL), '0') AS po_number`,
    );
  });
});
