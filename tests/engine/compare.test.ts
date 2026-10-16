// Comparing two results on real DuckDB-WASM (Node build): a source and the Join after it read side by side, each
// with its own rows, columns and count, and neither pane's read cancelling the other's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileDisplayPage, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { isCancelled } from '../../src/engine';
import { countRows, invalidateCaches, schemaCacheFor } from '../../src/flow/status';
import type { Project } from '../../src/model';
import { onlyHere, supersedeKey } from '../../src/results/compare';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

const orders = src({ id: 'cmp-orders', format: 'csv' });
const customers = src({ id: 'cmp-customers', format: 'csv' });

let gate: Promise<void> | null = null;
let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend({ beforeQuery: async () => void (await gate) }));
  for (const [s, file] of [[orders, 'shop-orders.csv'], [customers, 'shop-customers.csv']] as const)
    await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, '../fixtures', file))));
});
afterAll(() => engine.close());
beforeEach(() => invalidateCaches());

const shop = (): Project =>
  flow({
    sources: [orders, customers],
    nodes: [
      { id: 'o', type: 'source', sourceId: orders.id },
      { id: 'c', type: 'source', sourceId: customers.id },
      { id: 'j', type: 'join', joinSpec: { keys: [{ left: 'customer_id', right: 'customer_id' }] } },
    ],
    wires: [['o', 'j', 'left'], ['c', 'j', 'right']],
  });

const columnsOf = async (p: Project, nodeId: string) => (await schemaCacheFor(engine).get(p, { nodeId })).map((c) => c.name);

/** The first page of a node's rows, read as one pane's grid reads it. */
const page = (p: Project, nodeId: string, columns: string[], pane: 'main' | 'compare') =>
  engine.query(compileDisplayPage(p, { nodeId }, columns, 0), { supersede: supersedeKey(pane, 'preview'), label: 'Reading rows' }).then((r) => tableRows(r.table));

describe('comparing a source with the Join after it', () => {
  it('reads each side with its own rows, columns and count, and marks the columns only the Join has', async () => {
    const p = shop();
    const left = await columnsOf(p, 'o');
    const right = await columnsOf(p, 'j');
    expect(left).toEqual(['order_id', 'customer_id', 'total', 'status']);
    expect(right).toEqual(['order_id', 'customer_id', 'total', 'status', 'name', 'status_right']);
    expect([...onlyHere(right, left)]).toEqual(['name', 'status_right']);
    expect(onlyHere(left, right).size).toBe(0);

    const [a, b] = await Promise.all([page(p, 'o', left, 'main'), page(p, 'j', right, 'compare')]);
    expect(a).toHaveLength(5);
    expect(b).toHaveLength(6);
    expect(await Promise.all([countRows(engine, p, 'o'), countRows(engine, p, 'j')])).toEqual([5, 6]);
  });

  it("one pane's newer read cancels only its own older read, never the other pane's", async () => {
    const p = shop();
    const left = await columnsOf(p, 'o');
    const right = await columnsOf(p, 'j');
    // Hold the engine busy so the reads below queue up behind it.
    let open!: () => void;
    gate = new Promise((r) => (open = r));
    const busy = engine.query('SELECT 1 AS n', { label: 'Busy' });
    const stale = page(p, 'o', left, 'main');
    const compared = page(p, 'j', right, 'compare');
    const fresh = page(p, 'o', left, 'main');
    gate = null;
    open();
    await busy;
    await expect(stale).rejects.toSatisfy(isCancelled);
    expect(await compared).toHaveLength(6);
    expect(await fresh).toHaveLength(5);
  });
});
