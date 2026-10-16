// Kept results (pinned node results) on real DuckDB-WASM (Node build): a kept node becomes a table, previews
// downstream read the table instead of re-running upstream (checked by query log), it rebuilds when upstream
// changes, and it is dropped when no longer kept.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileDisplayPage, compileExport, knownKept, sourceFileName, upstreamKey } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { clearKeptStops, dropAllKept, keptSettled, keptTotal, keptView, syncKept, useKeptStore } from '../../src/flow/kept';
import { applySample } from '../../src/flow/sample';
import { evaluateFlow, invalidateCaches, schemaCacheFor } from '../../src/flow/status';
import { removeNodes, setKeepResult, type Project, type Step } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const cust = src({ id: 'cust', format: 'csv' });
const orders = src({ id: 'orders', format: 'csv' });
const customers = src({ id: 'customers', format: 'csv' });

const log: string[] = [];
/** While set, CREATE statements wait until released, so a test can press Stop during a build. */
let holdCreates = false;
let release: (() => void) | null = null;
let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(
    await createNodeBackend({
      beforeQuery: async (sql) => {
        log.push(sql);
        if (holdCreates && sql.startsWith('CREATE')) await new Promise<void>((r) => (release = r));
      },
    }),
  );
  for (const [s, file] of [[cust, 'customers.csv'], [orders, 'shop-orders.csv'], [customers, 'shop-customers.csv']] as const)
    await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, '../fixtures', file))));
});
afterAll(() => engine.close());
beforeEach(() => invalidateCaches());
afterEach(async () => {
  await dropAllKept(engine);
  log.length = 0;
});

const trim = step('s1', 'trimWhitespace', { columns: ['name'] });
const upper = step('s2', 'changeCase', { columns: ['name'], mode: 'upper' });
const withEmail = step('s3', 'filterRows', { conditions: [{ column: 'email', op: 'notEmpty' }] });

const chain = (steps: Step[] = [trim]): Project =>
  flow({
    sources: [cust],
    nodes: [
      { id: 'in', type: 'source', sourceId: 'cust' },
      { id: 't', type: 'transform', steps },
      { id: 'more', type: 'transform', steps: [upper] },
      { id: 'out', type: 'output' },
    ],
    wires: [['in', 't'], ['t', 'more'], ['more', 'out']],
  });

/** What the app does after each change: evaluate the flow, then bring kept tables up to date. */
async function settle(p: Project) {
  await evaluateFlow(engine, p);
  await syncKept(engine, p);
}

/** Every row of a node's preview, as the results table shows it. */
async function preview(p: Project, nodeId: string) {
  const columns = (await schemaCacheFor(engine).get(p, { nodeId })).map((c) => c.name);
  return tableRows((await engine.query(compileDisplayPage(p, { nodeId }, columns, 0))).table);
}

/** The same preview with nothing kept: every node compiled from its sources. */
const unkept = (p: Project) => ({ ...p, nodes: p.nodes.map(({ pinnedResult: _, ...n }) => n) }) as Project;

const tables = async () => tableRows((await engine.query(`SELECT table_name FROM duckdb_tables() ORDER BY 1`)).table).map((r) => r.table_name);

describe('kept results', () => {
  it('previews downstream of a kept node without re-running upstream', async () => {
    const p = setKeepResult(chain(), 't', true);
    await settle(p);
    expect(log.some((q) => q.startsWith('CREATE OR REPLACE TABLE "kept_t" AS'))).toBe(true);
    expect(await tables()).toEqual(['kept_t']);
    const entry = useKeptStore.getState().nodes.t!;
    expect(entry.bytes).toBeGreaterThan(0);
    expect(knownKept.get('t')?.table).toBe('kept_t');

    log.length = 0;
    const rows = await preview(p, 'out');
    expect(log.length).toBeGreaterThan(0);
    // Nothing upstream of the kept node ran: no file was read, no trim was applied.
    expect(log.filter((q) => /read_csv|trim\(/.test(q))).toEqual([]);
    expect(log.some((q) => q.includes('"kept_t"'))).toBe(true);
    expect(rows).toEqual(await preview(unkept(p), 'out'));
    expect(rows.map((r) => r.name)).toEqual(['ADA LOVELACE', 'GRACE HOPPER', 'EDSGER W. DIJKSTRA', '']);
  });

  it('rebuilds when an upstream step changes, matching a run with nothing kept', async () => {
    const p = setKeepResult(chain(), 't', true);
    await settle(p);
    const before = await preview(p, 'out');

    const changed = setKeepResult(chain([trim, withEmail]), 't', true);
    log.length = 0;
    // Until the rebuild, the stale table is never read.
    expect(compileDisplayPage(changed, { nodeId: 'out' }, ['name'])).toContain('read_csv');
    await settle(changed);
    expect(log.filter((q) => q.startsWith('CREATE OR REPLACE TABLE "kept_t"'))).toHaveLength(1);

    log.length = 0;
    const after = await preview(changed, 'out');
    expect(log.filter((q) => q.includes('read_csv'))).toEqual([]);
    expect(after).toEqual(await preview(unkept(changed), 'out'));
    expect(after).not.toEqual(before);
    expect(after).toHaveLength(3);

    // A change downstream of the kept node doesn't rebuild it.
    log.length = 0;
    await settle({ ...changed, nodes: changed.nodes.map((n) => (n.id === 'more' ? { ...n, steps: [] } : n)) });
    expect(log.filter((q) => q.startsWith('CREATE'))).toEqual([]);
  });

  it('catches up when upstream changes again while a build is queued or running', async () => {
    const first = setKeepResult(chain(), 't', true);
    const second = setKeepResult(chain([trim, withEmail]), 't', true);
    await evaluateFlow(engine, first);
    const building = syncKept(engine, first);
    // The user edits again before the first build is done.
    await evaluateFlow(engine, second);
    await syncKept(engine, second);
    await building;
    await keptSettled();
    expect(useKeptStore.getState().nodes.t?.key).toBe(upstreamKey(second, { nodeId: 't' }));
    expect(useKeptStore.getState().nodes.t?.building).toBeUndefined();
    expect(knownKept.get('t')?.key).toBe(upstreamKey(second, { nodeId: 't' }));
    expect(await preview(second, 'out')).toEqual(await preview(unkept(second), 'out'));
  });

  it('rebuilds a chain of kept nodes in order, each from the one before', async () => {
    const p = setKeepResult(setKeepResult(chain(), 't', true), 'more', true);
    await settle(p);
    const creates = log.filter((q) => q.startsWith('CREATE'));
    expect(creates.map((q) => q.slice(0, 35))).toEqual(['CREATE OR REPLACE TABLE "kept_t" AS', 'CREATE OR REPLACE TABLE "kept_more"']);
    expect(creates[1]).toContain('"kept_t"');
    expect(creates[1]).not.toContain('read_csv');

    log.length = 0;
    expect(await preview(p, 'out')).toEqual(await preview(unkept(p), 'out'));
    expect(log.filter((q) => q.includes('read_csv') && !q.includes('kept_'))).toHaveLength(1); // only the unkept run
  });

  it('drops the table when the node is no longer kept, or deleted, and counts the memory', async () => {
    const p = setKeepResult(setKeepResult(chain(), 't', true), 'more', true);
    await settle(p);
    expect(await tables()).toEqual(['kept_more', 'kept_t']);
    const total = keptTotal(useKeptStore.getState().nodes);
    expect(total).toBeGreaterThan(0);

    const one = setKeepResult(p, 'more', false);
    await settle(one);
    expect(await tables()).toEqual(['kept_t']);
    expect(knownKept.get('more')).toBeUndefined();
    expect(keptTotal(useKeptStore.getState().nodes)).toBeLessThan(total);

    await settle(removeNodes(one, ['t']));
    expect(await tables()).toEqual([]);
    expect(useKeptStore.getState().nodes).toEqual({});
  });

  it('drops every kept table when the project closes', async () => {
    await settle(setKeepResult(setKeepResult(chain(), 't', true), 'more', true));
    expect(await tables()).toHaveLength(2);
    await dropAllKept(engine);
    expect(await tables()).toEqual([]);
    expect(knownKept.ids()).toEqual([]);
    expect(useKeptStore.getState().nodes).toEqual({});
  });

  it('keeps a Join, and exports read its table while it is up to date', async () => {
    const shop = flow({
      sources: [orders, customers],
      nodes: [
        { id: 'o', type: 'source', sourceId: 'orders' },
        { id: 'c', type: 'source', sourceId: 'customers' },
        { id: 'j', type: 'join', joinSpec: { kind: 'left', keys: [{ left: 'customer_id', right: 'customer_id' }] } },
        { id: 'out', type: 'output' },
      ],
      wires: [['o', 'j', 'left'], ['c', 'j', 'right'], ['j', 'out']],
    });
    const p = setKeepResult(shop, 'j', true);
    await settle(p);
    expect(await tables()).toEqual(['kept_j']);

    log.length = 0;
    const exported = await engine.exportFile('kept.csv', (path) => compileExport(p, 'out', path));
    expect(log.filter((q) => q.includes('read_csv'))).toEqual([]);
    const plain = await engine.exportFile('plain.csv', (path) => compileExport(unkept(p), 'out', path));
    expect(exported.rows).toBe(plain.rows);
    expect(await exported.blob.text()).toBe(await plain.blob.text());
  });

  it('doesn’t build a node that fails, and builds it once it works', async () => {
    const broken = setKeepResult(chain([step('bad', 'removeColumns', { columns: ['phone'] })]), 't', true);
    await settle(broken);
    expect(log.filter((q) => q.startsWith('CREATE'))).toEqual([]);
    expect(useKeptStore.getState().nodes.t).toEqual({});
    await settle(setKeepResult(chain(), 't', true));
    expect(await tables()).toEqual(['kept_t']);
  });

  it('in sample mode keeps the sampled result for previews, while exports read the full data', async () => {
    const p = setKeepResult(chain(), 't', true);
    // The app's view of a project whose source is over the threshold: the source reads its first 2 rows.
    const view = applySample(p, { rows: 2, sources: { cust: 4 } });
    await settle(view);
    expect(Number((await engine.query('SELECT count(*) AS n FROM "kept_t"')).table.get(0)!.toJSON().n)).toBe(2);
    expect(upstreamKey(view, { nodeId: 't' })).not.toBe(upstreamKey(p, { nodeId: 't' }));

    log.length = 0;
    const rows = await preview(view, 'out');
    expect(log.filter((q) => q.includes('read_csv'))).toEqual([]);
    expect(rows).toEqual(await preview(unkept(view), 'out'));
    expect(rows).toHaveLength(2);

    // The export compiles the full project: its key isn't the sampled table's, so it reads the file, all of it.
    const sql = compileExport(p, 'out', '/x.csv');
    expect(sql).toContain('read_csv');
    expect(sql).not.toContain('kept_t');
    const exported = await engine.exportFile('sampled.csv', (path) => compileExport(p, 'out', path));
    expect(exported.rows).toBe(4);

    // Run on full data: the table is rebuilt from every row.
    await settle(p);
    expect(Number((await engine.query('SELECT count(*) AS n FROM "kept_t"')).table.get(0)!.toJSON().n)).toBe(4);
    expect(compileExport(p, 'out', '/x.csv')).toContain('"kept_t"');
  });

  it('Stop stops a build in progress and the builds queued behind it; nothing half-built is read', async () => {
    const p = setKeepResult(setKeepResult(chain(), 't', true), 'more', true);
    await settle(p);
    expect(await tables()).toEqual(['kept_more', 'kept_t']);

    const changed = setKeepResult(setKeepResult(chain([trim, withEmail]), 't', true), 'more', true);
    await evaluateFlow(engine, changed);
    holdCreates = true;
    const building = syncKept(engine, changed);
    try {
      await expect.poll(() => release).not.toBeNull();
      expect(engine.stop()).toBe(1);
    } finally {
      holdCreates = false;
      release?.();
      release = null;
    }
    await building;
    await keptSettled();

    // Neither table was replaced. The one whose build was under way is no longer read, even for the project it
    // was built for; the one that never started is still whole, and read only for the project it was built for.
    expect(log.filter((q) => q.startsWith('CREATE'))).toHaveLength(3);
    expect(knownKept.ids()).toEqual(['more']);
    expect(knownKept.get('more')?.key).toBe(upstreamKey(p, { nodeId: 'more' }));
    const { t, more } = useKeptStore.getState().nodes;
    expect(keptView(t, upstreamKey(changed, { nodeId: 't' }))).toEqual({ state: 'stopped' });
    expect(keptView(more, upstreamKey(changed, { nodeId: 'more' }))).toEqual({ state: 'stopped' });
    expect(keptView(t, upstreamKey(p, { nodeId: 't' })).state).not.toBe('ready');
    expect(keptTotal(useKeptStore.getState().nodes)).toBeGreaterThan(0); // the old tables still take memory
    expect(compileDisplayPage(p, { nodeId: 't' }, ['name'])).toContain('read_csv');
    expect(compileDisplayPage(changed, { nodeId: 'out' }, ['name'])).toContain('read_csv');
    expect(await preview(changed, 'out')).toEqual(await preview(unkept(changed), 'out'));

    // A later sync doesn't rebuild what was stopped; Run again does.
    log.length = 0;
    await syncKept(engine, changed);
    expect(log.filter((q) => q.startsWith('CREATE'))).toEqual([]);
    clearKeptStops();
    await syncKept(engine, changed);
    await keptSettled();
    expect(log.filter((q) => q.startsWith('CREATE'))).toHaveLength(2);
    expect(knownKept.get('more')?.key).toBe(upstreamKey(changed, { nodeId: 'more' }));
    expect(await preview(changed, 'out')).toEqual(await preview(unkept(changed), 'out'));
  });
});
