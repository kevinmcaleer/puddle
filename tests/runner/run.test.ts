// puddle-run on DuckDB's native build: a project file in a folder with its sources, run into an output folder.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, type RunnerDb } from '../../src/runner/db';
import { runProject, runSucceeded, type RunLog } from '../../src/runner/run';
import { parseArgs, projectFiles, watch } from '../../src/runner/cli';
import { sourceTableName } from '../../src/compiler';
import { parseProject, type Project } from '../../src/model';
import { flow, src, step } from '../helpers/projects';

let folder: string;
let db: RunnerDb;
beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'puddle-runner-'));
  mkdirSync(join(folder, 'sources'));
  writeFileSync(join(folder, 'sources', 'shop-customers.csv'), readFileSync(join(__dirname, '../fixtures/shop-customers.csv')));
  writeFileSync(join(folder, 'orders.csv'), readFileSync(join(__dirname, '../fixtures/shop-orders.csv')));
  db = await openDb();
});
afterAll(async () => {
  await db.close();
  rmSync(folder, { recursive: true, force: true });
});

const customers = { ...src({ id: 'c', format: 'csv' }), name: 'shop-customers.csv', file: { originalName: 'shop-customers.csv', size: 1, lastModified: 0, headHash: 'h' } };
const orders = { ...src({ id: 'o', format: 'csv' }), name: 'orders.csv', file: { originalName: 'orders.csv', size: 1, lastModified: 0, headHash: 'h' } };

function project(over: { rule?: Project['nodes'][number]['rules'][number] } = {}): Project {
  const p = flow({
    sources: [customers, orders],
    nodes: [
      { id: 'c', type: 'source', sourceId: 'c' },
      { id: 'o', type: 'source', sourceId: 'o' },
      { id: 't', type: 'transform', steps: [step('s1', 'trimWhitespace', { columns: ['name'] })] },
      { id: 'j', type: 'join', joinSpec: { keys: [{ left: 'customer_id', right: 'customer_id' }], kind: 'inner', suffix: '_right' } },
      { id: 'out', type: 'output', outputSpec: { format: 'csv', options: {} } },
      { id: 'out2', type: 'output', outputSpec: { format: 'parquet', options: {} } },
    ],
    wires: [
      ['c', 't', 0],
      ['t', 'j', 'left'],
      ['o', 'j', 'right'],
      ['j', 'out', 0],
      ['o', 'out2', 0],
    ],
  });
  p.name = 'Shop orders';
  if (over.rule) p.nodes = p.nodes.map((n) => (n.id === 't' ? { ...n, rules: [over.rule!] } : n));
  return p;
}

describe('puddle-run', () => {
  it('finds the sources by name, joins them with the same compiler, and writes each Output with a run log and report', async () => {
    const outDir = join(folder, 'out');
    const { log, report } = await runProject(project(), { folder, outDir, db, now: () => new Date('2026-10-17T03:00:00Z') });
    expect(log.sources.map((s) => [s.name, s.path?.replace(folder, '')])).toEqual([
      ['shop-customers.csv', '/sources/shop-customers.csv'],
      ['orders.csv', '/orders.csv'],
    ]);
    expect(log.outputs.map((o) => [o.nodeName, o.status, o.file])).toEqual([
      ['out', 'written', 'out.csv'],
      ['out2', 'written', 'out2.parquet'],
    ]);
    expect(log.outputs[0]!.rows).toBeGreaterThan(0);
    expect(runSucceeded(log)).toBe(true);
    const csv = readFileSync(join(outDir, 'out.csv'), 'utf8');
    expect(csv.split('\n')[0]).toContain('customer_id');
    expect(csv.trim().split('\n').length - 1).toBe(log.outputs[0]!.rows);
    expect(existsSync(join(outDir, 'out2.parquet'))).toBe(true);
    const saved = JSON.parse(readFileSync(join(outDir, 'shop-orders.run.json'), 'utf8')) as RunLog;
    expect(saved.schema).toBe('puddle-run/1');
    expect(saved.startedAt).toBe('2026-10-17T03:00:00.000Z');
    expect(readFileSync(join(outDir, 'shop-orders.quality.md'), 'utf8')).toContain('Shop orders');
    expect(report).toContain('No rules are set on this project.');
  });

  it('holds back an Output while a fail rule fails upstream, and skips one whose source is missing', async () => {
    const p = project({ rule: { id: 'r1', type: 'inRange', label: 'customer_id under 2', params: { column: 'customer_id', min: '', max: '1' }, severity: 'fail', enabled: true } });
    p.sources = p.sources.map((s) => (s.id === 'o' ? { ...s, file: { ...s.file!, originalName: 'missing.csv' } } : s));
    const outDir = join(folder, 'out-blocked');
    const lines: string[] = [];
    const { log } = await runProject(p, { folder, outDir, db, log: (l) => lines.push(l) });
    expect(log.outputs.map((o) => [o.nodeName, o.status])).toEqual([
      ['out', 'skipped'],
      ['out2', 'skipped'],
    ]);
    expect(log.outputs[0]!.reason).toMatch(/orders.csv was not found at .*missing\.csv/);
    expect(runSucceeded(log)).toBe(false);

    // With the orders back, the join's Output is blocked by the rule and the other one is written.
    const blocked = await runProject(project({ rule: p.nodes.find((n) => n.id === 't')!.rules[0] }), { folder, outDir, db });
    expect(blocked.log.outputs.map((o) => [o.nodeName, o.status])).toEqual([
      ['out', 'blocked'],
      ['out2', 'written'],
    ]);
    expect(blocked.log.outputs[0]!.blocking![0]).toMatch(/^customer_id under 2 fails on \d+ rows in t\.$/);
    expect(blocked.log.rules.t!.r1).toMatchObject({ state: 'ok' });
    expect(existsSync(join(outDir, 'out.csv'))).toBe(false);
  });

  it('watches a folder and runs a project on its schedule', async () => {
    const watched = mkdtempSync(join(tmpdir(), 'puddle-watch-'));
    try {
      writeFileSync(join(watched, 'customers.csv'), readFileSync(join(__dirname, '../fixtures/customers.csv')));
      const p = JSON.parse(readFileSync(join(__dirname, '../fixtures/projects/v1.puddle.json'), 'utf8')) as Project;
      // Six fields: every second, so the test needn't wait for a minute.
      p.settings.schedule = '* * * * * *';
      writeFileSync(join(watched, 'every-second.puddle.json'), JSON.stringify(p));
      writeFileSync(join(watched, 'unscheduled.puddle.json'), JSON.stringify({ ...p, settings: { ...p.settings, schedule: undefined } }));
      const stop = watch(watched, { pollMs: 200 });
      try {
        await expect.poll(() => existsSync(join(watched, 'out', 'customers-clean-up-format-1.run.json')), { timeout: 15_000 }).toBe(true);
      } finally {
        stop();
      }
      const log = JSON.parse(readFileSync(join(watched, 'out', 'customers-clean-up-format-1.run.json'), 'utf8')) as RunLog;
      expect(log.outputs.map((o) => o.status)).toEqual(['written']);
    } finally {
      rmSync(watched, { recursive: true, force: true });
    }
  });

  it('reads an XML source into rows, with the record and expanded element chosen in the browser', async () => {
    writeFileSync(join(folder, 'books.xml'), readFileSync(join(__dirname, '../fixtures/books.xml')));
    const books = { ...src({ id: 'b', format: 'xml' }), name: 'books.xml', parseOptions: { expand: 'author' }, file: { originalName: 'books.xml', size: 1, lastModified: 0, headHash: 'h' } };
    const p = flow({ sources: [books], nodes: [{ id: 'b', type: 'source', sourceId: 'b' }, { id: 'out', type: 'output', outputSpec: { format: 'csv', options: {} } }], wires: [['b', 'out', 0]] });
    p.name = 'Books';
    const outDir = join(folder, 'out-xml');
    const { log } = await runProject(p, { folder, outDir, db, now: () => new Date('2026-10-17T03:00:00Z') });
    expect(log.outputs[0]).toMatchObject({ status: 'written', rows: 4 });
    const csv = readFileSync(join(outDir, 'out.csv'), 'utf8').trim().split('\n');
    expect(csv[0]).toBe('id,format,title,published,price,price.currency,author,stock');
    expect(csv[3]).toBe('bk102,,Good Omens,1990-05-10,9.5,GBP,Neil Gaiman,0');
  });

  it('reads an Access table with the types the browser gives it, and says when its table isn’t there', async () => {
    writeFileSync(join(folder, 'shop.accdb'), readFileSync(join(__dirname, '../fixtures/shop.accdb')));
    const shop = (id: string, table: string) => ({ ...src({ id, format: 'access' }), name: table, parseOptions: { table }, file: { originalName: 'shop.accdb', size: 1, lastModified: 0, headHash: 'h' } });
    const p = flow({
      sources: [shop('o', 'Orders'), shop('a', 'Archive'), shop('x', 'Invoices')],
      nodes: [
        { id: 'o', type: 'source', sourceId: 'o' },
        { id: 'a', type: 'source', sourceId: 'a' },
        { id: 'x', type: 'source', sourceId: 'x' },
        { id: 'out', type: 'output', outputSpec: { format: 'csv', options: {} } },
        { id: 'out2', type: 'output', outputSpec: { format: 'csv', options: {} } },
        { id: 'out3', type: 'output', outputSpec: { format: 'csv', options: {} } },
      ],
      wires: [
        ['o', 'out', 0],
        ['a', 'out2', 0],
        ['x', 'out3', 0],
      ],
    });
    p.name = 'Shop';
    const outDir = join(folder, 'out-access');
    const { log } = await runProject(p, { folder, outDir, db, now: () => new Date('2026-10-17T03:00:00Z') });
    expect(log.outputs.map((o) => [o.nodeName, o.status, o.rows])).toEqual([
      ['out', 'written', 4],
      ['out2', 'written', 0],
      ['out3', 'skipped', undefined],
    ]);
    const csv = readFileSync(join(outDir, 'out.csv'), 'utf8').trim().split('\n');
    expect(csv[0]).toBe('OrderID,CustomerID,OrderDate,Quantity,Weight,Discount,Priority,Amount,Notes,Shipped');
    expect(csv[2]).toBe('2,2,2026-02-10 14:05:00,1,0.4,0.0,2,80.0000,,false');
    // Empty text stays apart from no value.
    expect(csv[4]).toBe('4,3,,,2.0,,,,"",false');
    expect(await db.describe(`SELECT * FROM "${sourceTableName(p.sources[0]!)}"`)).toContainEqual({ name: 'Amount', type: 'DECIMAL(19,4)' });
  });

  it('reads a text file with the skip options and column names the browser’s sniff set, the same rows as the browser', async () => {
    writeFileSync(join(folder, 'messy.txt'), readFileSync(join(__dirname, '../fixtures/messy/messy.txt')));
    const parseOptions = { delimiter: ';', skip: 2, skipBottom: 1, columns: ['Customer ID', 'Customer Name', 'City', 'Status', 'Signed up', 'Balance', 'Phone', 'Notes'] };
    const crm = { ...src({ id: 'm', format: 'csv' }), name: 'messy.txt', parseOptions, file: { originalName: 'messy.txt', size: 1, lastModified: 0, headHash: 'h' } };
    const p = flow({ sources: [crm], nodes: [{ id: 'm', type: 'source', sourceId: 'm' }, { id: 'out', type: 'output', outputSpec: { format: 'csv', options: {} } }], wires: [['m', 'out', 0]] });
    p.name = 'CRM';
    const outDir = join(folder, 'out-crm');
    const { log } = await runProject(p, { folder, outDir, db, now: () => new Date('2026-10-17T03:00:00Z') });
    // The two comment lines and the row count at the end are skipped; the header pasted in again is a row (an issue the browser lists).
    expect(log.outputs[0]).toMatchObject({ status: 'written', rows: 45 });
    const csv = readFileSync(join(outDir, 'out.csv'), 'utf8').trim().split('\n');
    expect(csv[0]).toBe('Customer ID,Customer Name,City,Status,Signed up,Balance,Phone,Notes');
    expect(csv[1]).toContain('CU1000,kofi jones,Cardiff');
    expect(csv[csv.length - 1]).toContain('CU1039,dev smith');
  });

  it('reads the command line and lists a folder’s project files', () => {
    expect(parseArgs(['run', 'a.puddle.json', '--out', '/tmp/x'])).toEqual({ command: 'run', target: 'a.puddle.json', out: '/tmp/x', poll: undefined });
    expect(parseArgs(['watch', '/projects', '--poll', '5'])).toMatchObject({ command: 'watch', target: '/projects', poll: 5 });
    expect(parseArgs([])).toMatchObject({ command: 'help' });
    writeFileSync(join(folder, 'b.puddle.json'), '{}');
    writeFileSync(join(folder, 'a.puddle.json'), '{}');
    expect(projectFiles(folder).map((f) => f.replace(folder, ''))).toEqual(['/a.puddle.json', '/b.puddle.json']);
  });
});

describe('puddle-run with schema tables', () => {
  const DBML = readFileSync(join(__dirname, '../fixtures/dbml/tables.dbml'), 'utf8');
  const withTables = (table: string) =>
    parseProject({
      ...flow({
        sources: [customers],
        nodes: [
          { id: 'c', type: 'source', sourceId: 'c' },
          { id: 'tbl', type: 'table', tableSpec: { table } },
          { id: 'out', type: 'output', outputSpec: { format: 'csv', options: {} } },
        ],
        wires: [
          ['c', 'tbl', 0],
          ['tbl', 'out', 0],
        ],
      }),
      schema: { dbml: DBML, positions: {} },
    });

  it('builds the schema, and writes nothing below a load the table refuses', async () => {
    const outDir = join(folder, 'out-schema');
    // The customers fixture repeats customer 5, which the key refuses.
    const { log } = await runProject(withTables('customers'), { folder, outDir, db });
    expect(log.outputs[0]).toMatchObject({ status: 'blocked', blocking: ['tbl can’t take some of the rows loaded into it: 2 rows have a customer_id that is already in the table or repeated.'] });
    expect(existsSync(join(outDir, 'out.csv'))).toBe(false);
  });
});
