// Kept results (pinned node results) on real DuckDB-WASM (Node build): a kept node becomes a table, previews
// downstream read the table instead of re-running upstream (checked by query log), it rebuilds when upstream
// changes, and it is dropped when no longer kept.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileDisplayPage, compileExport, knownKept, sourceFileName, upstreamKey } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { dropAllKept, keptSettled, keptTotal, syncKept, useKeptStore } from '../../src/flow/kept';
import { evaluateFlow, invalidateCaches, schemaCacheFor } from '../../src/flow/status';
import { removeNodes, setKeepResult, type Project, type Step } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const cust = src({ id: 'cust', format: 'csv' });
const orders = src({ id: 'orders', format: 'csv' });
const customers = src({ id: 'customers', format: 'csv' });

const log: string[] = [];
let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend({ beforeQuery: async (sql) => void log.push(sql) }));
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
});
