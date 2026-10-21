// puddle-run on DuckDB's native build: a project file in a folder with its sources, run into an output folder.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, type RunnerDb } from '../../src/runner/db';
import { runProject, runSucceeded, type RunLog } from '../../src/runner/run';
import { analyseFile } from '../../src/runner/analyse';
import { check, checkLines, formatChanged, parseArgs, projectFiles, watch } from '../../src/runner/cli';
import { secretsFrom, type PlaceOptions } from '../../src/runner/connections';
import type { Connection, DriverId } from '../../src/model';
import { sourceTableName } from '../../src/compiler';
import { parseProject, type Project, type Source } from '../../src/model';
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
    expect(readFileSync(join(outDir, 'shop-orders.quality.md'), 'utf8')).toBe(report);
    expect(report).toContain('# Quality report: Shop orders');
    expect(report).toContain('**0 rules.**');
    expect(report).toMatch(/\| shop-customers\.csv \| csv \| 5 \| `h` \|/);
  });

  it('writes the quality report as the browser does, in Markdown, JSON and HTML, with each node’s rules and the issues it kept from Fix all', async () => {
    const p = project({ rule: { id: 'r1', type: 'noEdgeSpaces', label: 'No leading or trailing spaces in name', params: { column: 'name' }, severity: 'warn', enabled: true } });
    p.nodes = p.nodes.map((n) =>
      n.id === 'c'
        ? {
            ...n,
            analysis: { at: '2026-10-21T09:00:00.000Z', rows: 4, issues: [{ key: 'edgeSpaces:name', kind: 'edgeSpaces', column: 'name', label: 'Spaces at either end of name', count: 2, fixed: true }, { key: 'duplicateRows', kind: 'duplicateRows', label: 'Duplicate rows', count: 1 }] },
            ignoredIssues: ['duplicateRows'],
          }
        : n,
    );
    const outDir = join(folder, 'out-report');
    const { quality } = await runProject(p, { folder, outDir, db, now: () => new Date('2026-10-21T10:00:00Z') });
    expect(quality.schema).toBe('puddle-quality-report/1');
    expect(quality.generatedAt).toBe('2026-10-21T10:00:00.000Z');
    expect(quality.nodes.map((n) => n.name)).toEqual(['c', 't']);
    expect(quality.nodes[0]!.analysis).toMatchObject({ found: 2, fixed: 1, ignored: 1, open: 0 });
    expect(quality.nodes[1]!.rules[0]).toMatchObject({ label: 'No leading or trailing spaces in name', status: 'pass', total: 5, failed: 0 });
    expect(quality.sources.map((s) => [s.name, s.rows, s.headHash])).toEqual([
      ['shop-customers.csv', 5, 'h'],
      ['orders.csv', 5, 'h'],
    ]);
    expect(JSON.parse(readFileSync(join(outDir, 'shop-orders.quality.json'), 'utf8'))).toEqual(quality);
    const md = readFileSync(join(outDir, 'shop-orders.quality.md'), 'utf8');
    expect(md).toContain('## c\n\nNo rules.\n\n### Issues\n\n2 issues found 21 Oct 2026, 09:00 UTC in 4 rows: 1 fixed, 1 ignored.');
    expect(md).toContain('| Fixed | Spaces at either end of name | name | 2 |');
    const html = readFileSync(join(outDir, 'shop-orders.quality.html'), 'utf8');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('data-outcome="ignored"');
  });

  it('check says when a source file no longer looks like the format the project reads it as', () => {
    const changed = mkdtempSync(join(tmpdir(), 'puddle-check-'));
    try {
      writeFileSync(join(changed, 'customers.csv'), readFileSync(join(__dirname, '../fixtures/customers.csv')));
      writeFileSync(join(changed, 'orders.csv'), readFileSync(join(__dirname, '../fixtures/items.json')));
      const p = { ...project(), sources: project().sources.map((s) => (s.id === 'c' ? { ...s, file: { ...s.file!, originalName: 'customers.csv' } } : s)) };
      writeFileSync(join(changed, 'shop.puddle.json'), JSON.stringify(p));
      expect(formatChanged(p.sources[0]!, join(changed, 'customers.csv'))).toBeUndefined();
      expect(formatChanged(p.sources[1]!, join(changed, 'orders.csv'))).toMatch(/^now looks like JSON, not CSV as the project reads it \(/);
      const lines: string[] = [];
      expect(check(join(changed, 'shop.puddle.json'), (l) => lines.push(l))).toBe(false);
      expect(lines[1]).toBe(`  source shop-customers.csv: ${join(changed, 'customers.csv')}`);
      expect(lines[2]).toMatch(/^ {2}source orders\.csv: .*orders\.csv; now looks like JSON, not CSV/);
    } finally {
      rmSync(changed, { recursive: true, force: true });
    }
  });

  it('analyses a file with no project, sniffing it as the editor does, and lists the editor’s issues', async () => {
    const a = await analyseFile(join(__dirname, '../fixtures/messy.csv'), db);
    expect(a).toMatchObject({ name: 'messy.csv', format: 'csv' });
    expect(a.analysis.facts.rows).toBe(5);
    expect(a.issues.map((i) => i.key)).toEqual(['duplicateRows', 'nonPrinting:name', 'edgeSpaces:name', 'doubleSpaces:name', 'emptyText:name', 'edgeSpaces:city', 'numbersAsText:price']);
    await expect(analyseFile(join(__dirname, '../fixtures/locked.accdb'), db)).rejects.toThrow();
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

  it('reads a gzipped CSV as it is, a file inside a zip, and an Arrow file with its types', async () => {
    writeFileSync(join(folder, 'orders.csv.gz'), readFileSync(join(__dirname, '../fixtures/archives/orders.csv.gz')));
    writeFileSync(join(folder, 'shop.zip'), readFileSync(join(__dirname, '../fixtures/archives/shop.zip')));
    writeFileSync(join(folder, 'customers.arrow'), readFileSync(join(__dirname, '../fixtures/archives/customers.arrow')));
    const file = (id: string, name: string, format: Source['format'], archive?: Source['archive']) => ({ ...src({ id, format }), name, archive, file: { originalName: name, size: 1, lastModified: 0, headHash: 'h' } });
    const p = flow({
      sources: [file('g', 'orders.csv.gz', 'csv', { kind: 'gzip', entry: 'orders.csv' }), file('z', 'shop.zip', 'csv', { kind: 'zip', entry: 'shop/customers.csv' }), file('a', 'customers.arrow', 'arrow')],
      nodes: [
        { id: 'g', type: 'source', sourceId: 'g' },
        { id: 'z', type: 'source', sourceId: 'z' },
        { id: 'a', type: 'source', sourceId: 'a' },
        { id: 'out', type: 'output', outputSpec: { format: 'csv', options: {} } },
        { id: 'out2', type: 'output', outputSpec: { format: 'csv', options: {} } },
        { id: 'out3', type: 'output', outputSpec: { format: 'csv', options: {} } },
      ],
      wires: [
        ['g', 'out', 0],
        ['z', 'out2', 0],
        ['a', 'out3', 0],
      ],
    });
    p.name = 'Archives';
    const outDir = join(folder, 'out-archives');
    const { log } = await runProject(p, { folder, outDir, db, now: () => new Date('2026-10-17T03:00:00Z') });
    expect(log.sources.map((s) => s.problem)).toEqual([undefined, undefined, undefined]);
    expect(log.outputs.map((o) => [o.nodeName, o.status, o.rows])).toEqual([
      ['out', 'written', 5],
      ['out2', 'written', 5],
      ['out3', 'written', 4],
    ]);
    expect(readFileSync(join(outDir, 'out.csv'), 'utf8').trim().split('\n').slice(0, 2)).toEqual(['order_id,customer_id,total,status', '100,1,12.5,shipped']);
    expect(readFileSync(join(outDir, 'out2.csv'), 'utf8').trim().split('\n').slice(0, 2)).toEqual(['customer_id,name,status', '1,Ada,active']);
    const arrow = readFileSync(join(outDir, 'out3.csv'), 'utf8').trim().split('\n');
    expect(arrow[0]).toBe('id,name,joined,balance,active');
    expect(arrow[1]).toBe('1,Ada,2026-01-05,12.5,true');
    expect(arrow[3]).toBe('3,Linus,,,false');
    expect(await db.describe(`SELECT * FROM "${sourceTableName(p.sources[2]!)}"`)).toEqual([
      { name: 'id', type: 'BIGINT' },
      { name: 'name', type: 'VARCHAR' },
      { name: 'joined', type: 'DATE' },
      { name: 'balance', type: 'DOUBLE' },
      { name: 'active', type: 'BOOLEAN' },
    ]);
  });

  it('reads YAML, TOML and GeoJSON into rows with the records the browser chose', async () => {
    writeFileSync(join(folder, 'servers.yaml'), readFileSync(join(__dirname, '../fixtures/structured/servers.yaml')));
    writeFileSync(join(folder, 'pyproject.toml'), readFileSync(join(__dirname, '../fixtures/structured/pyproject.toml')));
    writeFileSync(join(folder, 'places.geojson'), readFileSync(join(__dirname, '../fixtures/structured/places.geojson')));
    const file = (id: string, name: string, format: Source['format'], parseOptions: Source['parseOptions'] = {}) => ({ ...src({ id, format }), name, parseOptions, file: { originalName: name, size: 1, lastModified: 0, headHash: 'h' } });
    const p = flow({
      sources: [file('y', 'servers.yaml', 'yaml'), file('t', 'pyproject.toml', 'toml', { record: 'servers' }), file('g', 'places.geojson', 'geojson')],
      nodes: [
        { id: 'y', type: 'source', sourceId: 'y' },
        { id: 't', type: 'source', sourceId: 't' },
        { id: 'g', type: 'source', sourceId: 'g' },
        { id: 'out', type: 'output', outputSpec: { format: 'csv', options: {} } },
        { id: 'out2', type: 'output', outputSpec: { format: 'csv', options: {} } },
        { id: 'out3', type: 'output', outputSpec: { format: 'csv', options: {} } },
      ],
      wires: [
        ['y', 'out', 0],
        ['t', 'out2', 0],
        ['g', 'out3', 0],
      ],
    });
    p.name = 'Structured';
    const outDir = join(folder, 'out-structured');
    const { log } = await runProject(p, { folder, outDir, db, now: () => new Date('2026-10-17T03:00:00Z') });
    expect(log.sources.map((s) => s.problem)).toEqual([undefined, undefined, undefined]);
    expect(log.outputs.map((o) => [o.nodeName, o.status, o.rows])).toEqual([
      ['out', 'written', 3],
      ['out2', 'written', 2],
      ['out3', 'written', 3],
    ]);
    expect(readFileSync(join(outDir, 'out.csv'), 'utf8').trim().split('\n')[0]).toBe('name,ip,cores,tags,added,owner.team,owner.email');
    expect(readFileSync(join(outDir, 'out2.csv'), 'utf8').trim().split('\n')).toEqual(['key,ip,role', 'alpha,10.0.0.1,web', 'beta,10.0.0.2,db']);
    expect(readFileSync(join(outDir, 'out3.csv'), 'utf8').trim().split('\n')[1]).toBe('1,Lighthouse,landmark,34.5,"{""type"":""Point"",""coordinates"":[-3.1,53.4]}"');
  });

  it('reads a log file as the preset the browser chose, and as a custom pattern', async () => {
    writeFileSync(join(folder, 'access.log'), readFileSync(join(__dirname, '../fixtures/logs/access.log')));
    writeFileSync(join(folder, 'app.log'), readFileSync(join(__dirname, '../fixtures/logs/app.log')));
    const log = (id: string, name: string, parseOptions: Source['parseOptions']) => ({ ...src({ id, format: 'log' as const }), name, parseOptions, file: { originalName: name, size: 1, lastModified: 0, headHash: 'h' } });
    const p = flow({
      sources: [log('a', 'access.log', { preset: 'combined' }), log('c', 'app.log', { preset: 'custom', pattern: '^(?<time>\\S+ \\S+) (?<rest>.*)$' })],
      nodes: [
        { id: 'a', type: 'source', sourceId: 'a' },
        { id: 'c', type: 'source', sourceId: 'c' },
        { id: 'out', type: 'output', outputSpec: { format: 'csv', options: {} } },
        { id: 'out2', type: 'output', outputSpec: { format: 'csv', options: {} } },
      ],
      wires: [
        ['a', 'out', 0],
        ['c', 'out2', 0],
      ],
    });
    p.name = 'Logs';
    const outDir = join(folder, 'out-logs');
    const { log: runLog } = await runProject(p, { folder, outDir, db, now: () => new Date('2026-10-17T03:00:00Z') });
    expect(runLog.sources.map((s) => s.problem)).toEqual([undefined, undefined]);
    expect(runLog.outputs.map((o) => [o.nodeName, o.status, o.rows])).toEqual([
      ['out', 'written', 4],
      ['out2', 'written', 7],
    ]);
    expect(readFileSync(join(outDir, 'out.csv'), 'utf8').trim().split('\n').slice(0, 2)).toEqual(['host,ident,user,time,method,path,protocol,status,bytes,referrer,agent', '203.0.113.7,,,2026-10-10 12:55:36+00,GET,/index.html,HTTP/1.1,200,2326,https://example.org/start,Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0']);
    expect(readFileSync(join(outDir, 'out2.csv'), 'utf8').trim().split('\n')[1]).toBe('"2026-10-11 09:00:01,250",INFO Puddle runner started');
  });

  it('reads the table of a PDF the browser chose, through pdf.js', async () => {
    writeFileSync(join(folder, 'statement.pdf'), readFileSync(join(__dirname, '../fixtures/pdf/statement.pdf')));
    const pdf = (id: string, parseOptions: Source['parseOptions'] = {}) => ({ ...src({ id, format: 'pdf' as const }), name: 'statement.pdf', parseOptions, file: { originalName: 'statement.pdf', size: 1, lastModified: 0, headHash: 'h' } });
    const p = flow({
      sources: [pdf('a'), pdf('b', { table: '2' })],
      nodes: [
        { id: 'a', type: 'source', sourceId: 'a' },
        { id: 'b', type: 'source', sourceId: 'b' },
        { id: 'out', type: 'output', outputSpec: { format: 'csv', options: {} } },
        { id: 'out2', type: 'output', outputSpec: { format: 'csv', options: {} } },
      ],
      wires: [
        ['a', 'out', 0],
        ['b', 'out2', 0],
      ],
    });
    p.name = 'PDF';
    const outDir = join(folder, 'out-pdf');
    const { log } = await runProject(p, { folder, outDir, db, now: () => new Date('2026-10-17T03:00:00Z') });
    expect(log.sources.map((s) => s.problem)).toEqual([undefined, undefined]);
    expect(log.outputs.map((o) => [o.nodeName, o.status, o.rows])).toEqual([
      ['out', 'written', 4],
      ['out2', 'written', 2],
    ]);
    expect(readFileSync(join(outDir, 'out.csv'), 'utf8').trim().split('\n').slice(0, 2)).toEqual(['Date,Description,Paid in,Paid out', '2026-10-01,Salary October,"2,450.00",']);
    expect(readFileSync(join(outDir, 'out2.csv'), 'utf8').trim().split('\n')).toEqual(['Item,Amount', 'Opening balance,312.40', 'Closing balance,"1,634.19"']);
  });

  it('reads the table of a Word document the browser chose, and the biggest when none was', async () => {
    writeFileSync(join(folder, 'report.docx'), readFileSync(join(__dirname, '../fixtures/word/report.docx')));
    const doc = (id: string, parseOptions: Source['parseOptions'] = {}) => ({ ...src({ id, format: 'word' as const }), name: 'report.docx', parseOptions, file: { originalName: 'report.docx', size: 1, lastModified: 0, headHash: 'h' } });
    const p = flow({
      sources: [doc('a'), doc('b', { table: '1' })],
      nodes: [
        { id: 'a', type: 'source', sourceId: 'a' },
        { id: 'b', type: 'source', sourceId: 'b' },
        { id: 'out', type: 'output', outputSpec: { format: 'csv', options: {} } },
        { id: 'out2', type: 'output', outputSpec: { format: 'csv', options: {} } },
      ],
      wires: [
        ['a', 'out', 0],
        ['b', 'out2', 0],
      ],
    });
    p.name = 'Word';
    const outDir = join(folder, 'out-word');
    const { log } = await runProject(p, { folder, outDir, db, now: () => new Date('2026-10-17T03:00:00Z') });
    expect(log.sources.map((s) => s.problem)).toEqual([undefined, undefined]);
    expect(log.outputs.map((o) => [o.nodeName, o.status, o.rows])).toEqual([
      ['out', 'written', 3],
      ['out2', 'written', 4],
    ]);
    expect(readFileSync(join(outDir, 'out.csv'), 'utf8').trim().split('\n')[0]).toBe('Name,Role & team,Role & team 2,Started');
    expect(readFileSync(join(outDir, 'out2.csv'), 'utf8').trim().split('\n')).toEqual(['Region,Quarter,Amount', 'North,Q1,120.0', 'North,Q2,130.5', 'South,Q1,80.0', 'South,Q2,']);
  });

  it('reads spreadsheets in every format with the sheet options the browser saved: an old .xls and a dBase table', async () => {
    writeFileSync(join(folder, 'sales.xls'), readFileSync(join(__dirname, '../fixtures/formats/sales.xls')));
    writeFileSync(join(folder, 'sales.dbf'), readFileSync(join(__dirname, '../fixtures/formats/sales.dbf')));
    const sheet = (id: string, name: string, parseOptions: Source['parseOptions'] = {}) => ({ ...src({ id, format: 'xlsx' }), name, parseOptions, file: { originalName: name, size: 1, lastModified: 0, headHash: 'h' } });
    const p = flow({
      sources: [sheet('x', 'sales.xls', { sheet: 'Visits' }), sheet('d', 'sales.dbf')],
      nodes: [
        { id: 'x', type: 'source', sourceId: 'x' },
        { id: 'd', type: 'source', sourceId: 'd' },
        { id: 'out', type: 'output', outputSpec: { format: 'csv', options: {} } },
        { id: 'out2', type: 'output', outputSpec: { format: 'csv', options: {} } },
      ],
      wires: [
        ['x', 'out', 0],
        ['d', 'out2', 0],
      ],
    });
    p.name = 'Sheets';
    const outDir = join(folder, 'out-sheets');
    const { log } = await runProject(p, { folder, outDir, db, now: () => new Date('2026-10-17T03:00:00Z') });
    expect(log.sources.map((s) => s.problem)).toEqual([undefined, undefined]);
    expect(log.outputs.map((o) => [o.nodeName, o.status, o.rows])).toEqual([
      ['out', 'written', 2],
      ['out2', 'written', 4],
    ]);
    // The Visits sheet, with its date-times, through the same reader as the browser's, typed by DuckDB.
    expect(readFileSync(join(outDir, 'out.csv'), 'utf8').trim().split('\n')).toEqual(['Visitor,Arrived,Count,Mixed', 'Ann,2026-01-05 09:30:00,3,1', 'Bob,2026-01-06 14:00:00,5,two']);
    expect(await db.describe(`SELECT * FROM "${sourceTableName(p.sources[0]!)}"`)).toEqual([
      { name: 'Visitor', type: 'VARCHAR' },
      { name: 'Arrived', type: 'TIMESTAMP' },
      { name: 'Count', type: 'BIGINT' },
      { name: 'Mixed', type: 'VARCHAR' },
    ]);
    const dbf = readFileSync(join(outDir, 'out2.csv'), 'utf8').trim().split('\n');
    expect(dbf[0]).toBe('Region,Order date,Amount,Paid,Notes');
    expect(dbf[1]).toBe('North,2026-01-05,120.5,true,First order');
    expect(dbf[2]).toBe('South,2026-02-10,80.0,false,');
    expect(await db.describe(`SELECT * FROM "${sourceTableName(p.sources[1]!)}"`)).toEqual([
      { name: 'Region', type: 'VARCHAR' },
      { name: 'Order date', type: 'DATE' },
      { name: 'Amount', type: 'DOUBLE' },
      { name: 'Paid', type: 'BOOLEAN' },
      { name: 'Notes', type: 'VARCHAR' },
    ]);
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

  it('reads fixed-width text at the boundaries the browser found, and a pipe table with the lines around it left out', async () => {
    writeFileSync(join(folder, 'fixed-width.txt'), readFileSync(join(__dirname, '../fixtures/messy/fixed-width.txt')));
    writeFileSync(join(folder, 'sap-extract.txt'), readFileSync(join(__dirname, '../fixtures/messy/sap-extract.txt')));
    const text = (id: string, name: string, format: 'fixed' | 'pipes', parseOptions: Source['parseOptions']) => ({ ...src({ id, format }), name, parseOptions, file: { originalName: name, size: 1, lastModified: 0, headHash: 'h' } });
    const p = flow({
      sources: [text('f', 'fixed-width.txt', 'fixed', { boundaries: [8, 30, 43, 54, 64] }), text('s', 'sap-extract.txt', 'pipes', { encoding: 'latin-1' })],
      nodes: [
        { id: 'f', type: 'source', sourceId: 'f' },
        { id: 's', type: 'source', sourceId: 's' },
        { id: 'out', type: 'output', outputSpec: { format: 'csv', options: {} } },
        { id: 'out2', type: 'output', outputSpec: { format: 'csv', options: {} } },
      ],
      wires: [
        ['f', 'out', 0],
        ['s', 'out2', 0],
      ],
    });
    p.name = 'Reports';
    const outDir = join(folder, 'out-text');
    const { log } = await runProject(p, { folder, outDir, db, now: () => new Date('2026-10-17T03:00:00Z') });
    expect(log.outputs.map((o) => [o.nodeName, o.status, o.rows])).toEqual([
      ['out', 'written', 30],
      ['out2', 'written', 61],
    ]);
    const fixed = readFileSync(join(outDir, 'out.csv'), 'utf8').trim().split('\n');
    expect(fixed[0]).toBe('CUSTNO,NAME,CITY,BALANCE,SINCE,ST');
    expect(fixed[1]).toBe('100200,Kofi Patel,Leeds,"15,369.45",20240914,A');
    const sap = readFileSync(join(outDir, 'out2.csv'), 'utf8').trim().split('\n');
    expect(sap[0]).toBe('Doc. no.,Vendor,Doc. date,Pstng date,Crcy,Amount in LC,Cost ctr,Text');
    expect(sap.some((l) => l.includes('Müller GmbH'))).toBe(true);
    expect(sap[sap.length - 1]).toMatch(/^\*,/);
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

describe('puddle-run with connection sources', () => {
  const served = new Set<DriverId>(['sqlite', 'libsql', 'postgres', 'mysql']);
  const options = (env: Record<string, string | undefined> = {}, file = '{}'): PlaceOptions => ({ secretOf: secretsFrom(env, () => file), served, env });
  const connSource = (id: string, connectionId: string, read: Partial<Source['connection']>): Source => ({ ...src({ id, format: 'connection' }), name: id, kind: 'connection', connection: { connectionId, columns: [], ...read } });
  const withConnections = (connections: Connection[], sources: Source[]): Project => ({
    ...flow({
      sources,
      nodes: sources.flatMap((s) => [{ id: s.id, type: 'source' as const, sourceId: s.id }, { id: `out-${s.id}`, type: 'output' as const, outputSpec: { format: 'parquet', options: {} } }]),
      wires: sources.map((s) => [s.id, `out-${s.id}`, 0] as [string, string, 0]),
    }),
    name: 'Connections',
    connections,
  });

  it('reads a SQLite file picked in the browser by its name beside the project, with the types the driver declares, and skips a source whose connection needs a secret', async () => {
    writeFileSync(join(folder, 'sources', 'shop.sqlite'), readFileSync(join(__dirname, '../fixtures/db/shop.sqlite')));
    const sqlite: Connection = { id: 'sq', name: 'Shop file', driver: 'sqlite', via: 'browser', settings: { file: 'shop.sqlite' }, auth: 'none' };
    const pg: Connection = { id: 'pg', name: 'Shop DB', driver: 'postgres', via: 'pi', settings: { host: 'db', database: 'shop', user: 'puddle' }, auth: 'password' };
    const p = withConnections([sqlite, pg], [connSource('cust', 'sq', { table: { name: 'customers' } }), connSource('tot', 'sq', { query: 'SELECT customer_id, sum(total) AS spent FROM orders GROUP BY customer_id', limit: 2 }), connSource('far', 'pg', { table: { name: 'orders' } })]);
    const outDir = join(folder, 'out-connections');
    const lines: string[] = [];
    const { log } = await runProject(p, { folder, outDir, db, connections: options(), log: (l) => lines.push(l), now: () => new Date('2026-10-21T03:00:00Z') });
    expect(log.sources).toEqual([
      { id: 'cust', name: 'cust', connection: 'table customers of connection “Shop file” (SQLite)', rows: 3 },
      { id: 'tot', name: 'tot', connection: 'a query of connection “Shop file” (SQLite)', rows: 2 },
      { id: 'far', name: 'far', problem: 'needs the password of connection “Shop DB”: set PUDDLE_SECRET_SHOP_DB, or add "Shop DB" to the PUDDLE_SECRETS file' },
    ]);
    expect(log.outputs.map((o) => [o.nodeName, o.status, o.rows])).toEqual([
      ['out-cust', 'written', 3],
      ['out-tot', 'written', 2],
      ['out-far', 'skipped', undefined],
    ]);
    expect(lines).toContain('Source cust: read 3 rows from table customers of connection “Shop file” (SQLite).');
    const rows = await db.query(`SELECT * FROM read_parquet('${join(outDir, 'out-cust.parquet').replaceAll("'", "''")}') ORDER BY id`);
    expect(rows.map((r) => [r.id, r.name, r.email, r.active])).toEqual([
      [1n, 'Ada Lovelace', 'ada@example.com', true],
      [2n, 'Grace Hopper', 'grace@example.com', true],
      [3n, 'Alan Turing', null, false],
    ]);
    expect(await db.describe(`SELECT * FROM "${sourceTableName(p.sources[0]!)}"`)).toEqual(expect.arrayContaining([{ name: 'id', type: 'BIGINT' }, { name: 'active', type: 'BOOLEAN' }]));
    // The staging table the stream went through is gone.
    expect((await db.query(`SELECT count(*) AS n FROM duckdb_tables() WHERE table_name LIKE '%_arrow'`))[0]!.n).toBe(0n);
  });

  const pgUrl = process.env.PUDDLE_TEST_POSTGRES;
  it.skipIf(!pgUrl)('reads a PostgreSQL table with the secret from a PUDDLE_SECRETS file, and writes it as Parquet', async () => {
    const u = new URL(pgUrl!);
    const pg: Connection = { id: 'pg', name: 'Shop DB', driver: 'postgres', via: 'pi', settings: { host: u.hostname, port: Number(u.port) || 5432, database: u.pathname.slice(1), user: decodeURIComponent(u.username) }, auth: 'password' };
    const p = withConnections([pg], [connSource('orders', 'pg', { table: { schema: 'public', name: 'orders' } })]);
    const secrets = join(folder, 'secrets.json');
    writeFileSync(secrets, JSON.stringify({ 'Shop DB': decodeURIComponent(u.password) }));
    const outDir = join(folder, 'out-postgres');
    const { log } = await runProject(p, { folder, outDir, db, connections: { secretOf: secretsFrom({ PUDDLE_SECRETS: secrets }, (f) => readFileSync(f, 'utf8')), served, env: { PUDDLE_SECRETS: secrets } } });
    expect(log.sources[0]).toEqual({ id: 'orders', name: 'orders', connection: 'table public.orders of connection “Shop DB” (PostgreSQL, secret from PUDDLE_SECRETS)', rows: 4 });
    expect(log.outputs[0]).toMatchObject({ status: 'written', rows: 4, file: 'out-orders.parquet' });
    expect(await db.describe(`SELECT * FROM read_parquet('${join(outDir, 'out-orders.parquet').replaceAll("'", "''")}')`)).toContainEqual({ name: 'total', type: 'DECIMAL(10,2)' });
  });

  it('check says what each connection source reads and which secret it still needs', () => {
    const sqlite: Connection = { id: 'sq', name: 'Shop file', driver: 'sqlite', via: 'browser', settings: { file: 'shop.sqlite' }, auth: 'none' };
    const pg: Connection = { id: 'pg', name: 'Shop DB', driver: 'postgres', via: 'pi', settings: { host: 'db' }, auth: 'password' };
    const p = withConnections([sqlite, pg], [connSource('cust', 'sq', { table: { name: 'customers' } }), connSource('far', 'pg', { table: { name: 'orders' } })]);
    const exists = (path: string) => path === join(folder, 'sources', 'shop.sqlite');
    expect(checkLines(p, folder, exists, options())).toEqual({
      ok: false,
      lines: ['Connections', '  source cust: reads table customers of connection “Shop file” (SQLite)', '  source far: needs the password of connection “Shop DB”: set PUDDLE_SECRET_SHOP_DB, or add "Shop DB" to the PUDDLE_SECRETS file', '  output out-cust: parquet', '  output out-far: parquet', '  schedule: none (set one in the Project tab to run it from a folder)'],
    });
    expect(checkLines(p, folder, exists, options({ PUDDLE_SECRET_SHOP_DB: 'pw' }))).toMatchObject({ ok: true, lines: expect.arrayContaining(['  source far: reads table orders of connection “Shop DB” (PostgreSQL, secret from PUDDLE_SECRET_SHOP_DB)']) });
  });

  it('refuses a project file that carries a secret in a connection’s settings', () => {
    const pg: Connection = { id: 'pg', name: 'Shop DB', driver: 'postgres', via: 'pi', settings: { host: 'db', password: 'hunter2' }, auth: 'password' };
    const file = join(folder, 'leaky.puddle.json');
    writeFileSync(file, JSON.stringify(withConnections([pg], [connSource('far', 'pg', { table: { name: 'orders' } })])));
    expect(() => check(file)).toThrow('leaky.puddle.json is refused: connection “Shop DB” has a password in its settings. Puddle never writes a secret into a project file: take it out and give it through PUDDLE_SECRET_SHOP_DB or the PUDDLE_SECRETS file.');
  });
});
