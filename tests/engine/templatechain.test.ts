// A template inserted as a chain of one-step nodes gives the same result as the same steps in one node, on real
// DuckDB-WASM (Node build) against tests/fixtures/messy.csv. Whether the steps are bundled as a group of nodes or
// merged into one Transform, the data that comes out is the same.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileDisplayPage, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { groupNodes, ungroupNode, type Project } from '../../src/model';
import { insertTemplate, insertTemplateChain } from '../../src/templates/insert';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const messy = src({ id: 'messy', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(messy), new Uint8Array(readFileSync(join(__dirname, '../fixtures/messy.csv'))));
});
afterAll(() => engine.close());

const base = () => flow({ sources: [messy], nodes: [{ id: 'in', type: 'source', sourceId: messy.id }], wires: [] });

const template = () => [
  step('s1', 'trimWhitespace', { columns: ['name', 'city'] }),
  step('s2', 'collapseSpaces', { columns: ['name'] }),
  step('s3', 'changeCase', { columns: ['name', 'city'], mode: 'title' }),
  step('s4', 'parseNumbers', { columns: ['price'], locale: 'en-GB' }),
];

async function rowsAt(p: Project, nodeId: string) {
  const schema = await engine.describe(compile(p, { nodeId }).sql);
  return tableRows((await engine.query(compileDisplayPage(p, { nodeId }, schema.map((c) => c.name), 0))).table);
}

describe('a template as a chain of nodes', () => {
  it('reads the same as the same steps in one node, merged or split', async () => {
    const one = insertTemplate(base(), 'Tidy', template(), { x: 300, y: 0 }, 'in', 'single');
    const chain = insertTemplateChain(base(), 'Tidy', template(), { x: 300, y: 0 }, 'in', ['c1', 'c2', 'c3', 'c4'], 'g');
    const expected = await rowsAt(one, 'single');
    expect(expected.map((r) => r.name)).toEqual(['Ada Lovelace', 'Grace Hopper', 'Edsger​dijkstra', '', 'Edsger​dijkstra']);
    expect(expected.map((r) => r.price)).toEqual(['1234.5', '99.0', '-12.0', '75.0', '-12.0']);
    expect(await rowsAt(chain, 'c4')).toEqual(expected);
    // Merged into one node from the group's menu, and split back again: still the same data.
    const merged = groupNodes(chain, ['c1', 'c2', 'c3', 'c4']);
    expect(merged.nodes.map((n) => n.id)).toEqual(['in', 'c1']);
    expect(await rowsAt(merged, 'c1')).toEqual(expected);
    expect(await rowsAt(ungroupNode(merged, 'c1'), 'c4')).toEqual(expected);
  });
});
