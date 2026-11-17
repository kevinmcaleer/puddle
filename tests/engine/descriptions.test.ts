// Descriptions are words for people: describing nodes and groups never changes what runs. Checked on real
// DuckDB-WASM (Node build) against a fixture file, and on the keys that decide when results and kept tables rebuild.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileDisplayPage, sourceFileName, upstreamKey } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { makeGroup, setGroupDescription, setNodeDescription, type Project, type Source } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const cust: Source = src({ id: 'cust', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(cust), new Uint8Array(readFileSync(join(__dirname, '../fixtures/customers.csv'))));
});
afterAll(() => engine.close());

// customers.csv → trim emails → upper-case names → Output, the two transforms in a group.
const plain = (): Project =>
  makeGroup(
    flow({
      sources: [cust],
      nodes: [
        { id: 'in', type: 'source', sourceId: 'cust' },
        { id: 'trim', type: 'transform', steps: [step('s1', 'trimWhitespace', { columns: ['email'] })] },
        { id: 'upper', type: 'transform', steps: [step('s2', 'changeCase', { columns: ['name'], mode: 'upper' })] },
        { id: 'out', type: 'output' },
      ],
      wires: [['in', 'trim'], ['trim', 'upper'], ['upper', 'out']],
    }),
    ['trim', 'upper'],
    'g1',
  );

const described = (): Project => {
  let p = plain();
  p = setNodeDescription(p, 'in', 'customers exported from the shop');
  p = setNodeDescription(p, 'trim', 'emails arrive with spaces round them');
  p = setNodeDescription(p, 'out', 'combine into a single list');
  return setGroupDescription(p, 'g1', 'tidy the contact details');
};

describe('descriptions on real DuckDB', () => {
  it('give the same rows and the same SQL as the flow without them', async () => {
    const rows = async (p: Project) => tableRows((await engine.query(compileDisplayPage(p, { nodeId: 'out' }, ['name', 'email'], 0, 50))).table);
    const before = await rows(plain());
    expect(before.length).toBeGreaterThan(0);
    expect(await rows(described())).toEqual(before);
    expect(compile(described(), { nodeId: 'out' }).sql).toBe(compile(plain(), { nodeId: 'out' }).sql);
  });

  it('leave the keys results and kept tables rebuild on as they were, so describing never reruns anything', () => {
    for (const nodeId of ['in', 'trim', 'upper', 'out']) expect(upstreamKey(described(), { nodeId })).toBe(upstreamKey(plain(), { nodeId }));
  });
});
