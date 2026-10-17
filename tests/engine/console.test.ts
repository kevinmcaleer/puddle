// The scratch console on real DuckDB-WASM (Node build): a query against the viewed node, cut to the row limit.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileConsole, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

const orders = src({ id: 'shop-orders', format: 'csv' });
const project = flow({ sources: [orders], nodes: [{ id: 'o', type: 'source', sourceId: orders.id }], wires: [] });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(orders), new Uint8Array(readFileSync(join(__dirname, `../fixtures/${orders.id}.csv`))));
});
afterAll(() => engine.close());

describe('the scratch console', () => {
  it('answers a query over the viewed rows and stops at the row limit', async () => {
    const count = tableRows((await engine.query(compileConsole(project, { nodeId: 'o' }, 'SELECT count(*) AS n FROM input'))).table);
    expect(Number(count[0]!.n)).toBeGreaterThan(3);
    const some = tableRows((await engine.query(compileConsole(project, { nodeId: 'o' }, 'SELECT * FROM input', 3))).table);
    expect(some).toHaveLength(3);
  });
});
