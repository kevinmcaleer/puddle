// A table's data sample on the Schema diagram, on real DuckDB-WASM: the rows its Schema table node holds once a CSV
// loads into it, else the DBML's records.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceFileName } from '../../src/compiler';
import { EngineClient } from '../../src/engine/client';
import { invalidateCaches } from '../../src/flow/status';
import { parseProject, type Project } from '../../src/model';
import { parseDbml } from '../../src/schema';
import { buildSchema } from '../../src/schemaTables/build';
import { tableSample } from '../../src/schemaTables/sample';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

const DBML = readFileSync(join(__dirname, '../fixtures/dbml/tables.dbml'), 'utf8');
const schema = parseDbml(DBML).schema;
const customersCsv = src({ id: 'shop-customers', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(customersCsv), new Uint8Array(readFileSync(join(__dirname, '../fixtures/shop-customers.csv'))));
});
afterAll(() => engine.close());
beforeEach(() => invalidateCaches());

function project(withNode: boolean): Project {
  const base = flow({ sources: [customersCsv], nodes: [] as never[], wires: [] });
  const nodes = withNode
    ? [
        { id: 'csv', name: 'csv', type: 'source', sourceId: customersCsv.id },
        { id: 'cust', name: 'customers', type: 'table', tableSpec: { table: 'customers' } },
      ]
    : [];
  return parseProject({ ...base, schema: { dbml: DBML, positions: {} }, nodes, edges: withNode ? [{ id: 'e0', from: { nodeId: 'csv' }, to: { nodeId: 'cust', port: 0 } }] : [] });
}

const customers = schema.tables.find((t) => t.name === 'customers')!;

describe('a table’s data sample', () => {
  it('shows the rows loaded into its Schema table node from a CSV, after the table’s records', async () => {
    const p = project(true);
    await buildSchema(engine, p);
    const s = await tableSample(engine, p, schema, customers);
    expect(s.from).toEqual({ node: 'cust', name: 'customers' });
    expect(s.columns.slice(0, 2)).toEqual(['customer_id', 'name']);
    expect(s.rows.map((r) => r[1])).toEqual(['Margaret', 'Ada', 'Grace', 'Edsger', 'Barbara']);
  });

  it('shows the DBML’s records when the table has no node', async () => {
    const s = await tableSample(engine, project(false), schema, customers);
    expect(s).toMatchObject({ from: 'records', total: 1 });
    expect(s.rows[0]).toContain('Margaret');
  });
});
