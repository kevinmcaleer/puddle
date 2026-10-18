// The relationships view on real DuckDB-WASM (Node build): relationships found from a Join on a real flow, which ends
// are "one" and which "many" as checked by DuckDB, and the DBML written from them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileKeyCheck, sourceFileName } from '../../src/compiler';
import { EngineClient } from '../../src/engine/client';
import { checkKeys } from '../../src/flow/keys';
import { evaluateFlow, invalidateCaches, useFlowStore } from '../../src/flow/status';
import type { Project } from '../../src/model';
import { toDbml } from '../../src/relationships/dbml';
import { cardinality, describeCardinality, findRelationships, keyColumns, relationshipTables, type Uniqueness } from '../../src/relationships/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const orders = src({ id: 'orders', format: 'csv' });
const customers = src({ id: 'customers', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  for (const [s, file] of [[orders, 'shop-orders.csv'], [customers, 'shop-customers.csv']] as const)
    await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, '../fixtures', file))));
});
afterAll(() => engine.close());
beforeEach(() => invalidateCaches());

/** Orders, cleaned by a Transform, joined to Customers on customer_id. `customerSteps` change the Customers side. */
const shop = (customerSteps = [] as ReturnType<typeof step>[]): Project => {
  const p = flow({
    sources: [orders, customers],
    nodes: [
      { id: 'o', type: 'source', sourceId: 'orders' },
      { id: 'clean', type: 'transform' },
      { id: 'c', type: 'source', sourceId: 'customers' },
      { id: 'cust', type: 'transform', steps: customerSteps },
      { id: 'j', type: 'join', joinSpec: { keys: [{ left: 'customer_id', right: 'customer_id' }] } },
    ],
    wires: [['o', 'clean'], ['c', 'cust'], ['clean', 'j', 'left'], ['cust', 'j', 'right']],
  });
  return { ...p, nodes: p.nodes.map((n) => (n.id === 'o' ? { ...n, name: 'Orders' } : n.id === 'c' ? { ...n, name: 'Customers' } : n.id === 'j' ? { ...n, name: 'Join 1' } : n)) };
};

/** The flow evaluated, then the relationships with their keys checked, as the view shows them. */
async function view(p: Project) {
  await evaluateFlow(engine, p);
  const statuses = useFlowStore.getState().nodes;
  const columnsOf = (id: string) => {
    const s = statuses[id]?.status;
    return s?.state === 'ok' ? s.columns : undefined;
  };
  const relationships = findRelationships(p, columnsOf);
  const tables = relationshipTables(p, relationships, columnsOf);
  const unique: Uniqueness = {};
  for (const [nodeId, columns] of keyColumns(relationships)) unique[nodeId] = await checkKeys(engine, p, nodeId, columns);
  return { relationships, tables, unique };
}

describe('relationships on real data', () => {
  it('finds the join key on the two sources; customer 5 appears twice, so many to many', async () => {
    const { relationships, tables, unique } = await view(shop());
    expect(relationships.map((r) => `${r.from.nodeId}.${r.from.column} = ${r.to.nodeId}.${r.to.column}`)).toEqual(['o.customer_id = c.customer_id']);
    expect(tables.map((t) => t.name)).toEqual(['Orders', 'Customers']);
    expect(describeCardinality(unique, relationships[0]!)).toBe('many to many');
  });

  it('checks the keys as the join reads them: customers with duplicates removed are the one end', async () => {
    const { relationships, unique } = await view(shop([step('s1', 'duplicateRows', { columns: ['customer_id'], keep: 'first' })]));
    const r = relationships[0]!;
    // Drawn on the Customers source, checked on the Transform the Join reads.
    expect(r.to).toEqual({ nodeId: 'c', column: 'customer_id' });
    expect(r.read.to).toEqual({ nodeId: 'cust', column: 'customer_id' });
    expect(describeCardinality(unique, r)).toBe('many to one');
    expect(cardinality(unique, r, 'to')).toBe('one');
  });

  it('counts empty values as no repeat, and a repeated value as many', async () => {
    const p = shop();
    await evaluateFlow(engine, p);
    const row = (await engine.query(compileKeyCheck(p, 'o', ['order_id', 'customer_id']))).table.toArray()[0]!.toJSON();
    expect(row).toEqual({ u0: true, u1: false });
  });

  it('writes the tables, their DuckDB types and the ref as DBML', async () => {
    const { relationships, tables, unique } = await view(shop([step('s1', 'duplicateRows', { columns: ['customer_id'], keep: 'first' })]));
    const dbml = toDbml({ name: 'Shop' }, tables, relationships, unique);
    expect(dbml).toContain('Table "Orders" {\n  "order_id" BIGINT\n  "customer_id" BIGINT\n');
    expect(dbml).toContain('Table "Customers" {\n  "customer_id" BIGINT [unique]');
    expect(dbml).toContain('Ref: "Orders"."customer_id" > "Customers"."customer_id" // Join 1');
  });
});
