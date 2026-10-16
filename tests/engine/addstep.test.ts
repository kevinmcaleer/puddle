// Building a step from the Add step menu on real DuckDB-WASM (Node build) against tests/fixtures/numbers.csv.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceFileName } from '../../src/compiler';
import { EngineClient } from '../../src/engine/client';
import { buildStep } from '../../src/inspector/addStep';
import { stepForm } from '../../src/steps';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const numbers = src({ id: 'numbers', format: 'csv' });

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(numbers), new Uint8Array(readFileSync(join(__dirname, '../fixtures/numbers.csv'))));
});
afterAll(() => engine.close());

const project = (steps = [step('s0', 'roundNumbers', { columns: ['amount'], mode: 'places', places: 0 })]) =>
  flow({
    sources: [numbers],
    nodes: [
      { id: 'in', type: 'source', sourceId: numbers.id },
      { id: 't', type: 'transform', steps },
    ],
    wires: [['in', 't']],
  });

describe('buildStep', () => {
  // Regression: picking Round before the inspector had read the input's columns gave it no columns, so clicking
  // price then id in the form chose "price, id" instead of just price (numbers.spec "round to places").
  it('reads the arriving columns itself while the inspector has none yet', async () => {
    const built = await buildStep(stepForm('roundNumbers')!, engine, project([]), 't', -1, [], []);
    expect(built.params.columns).toEqual(['id']);
  });

  it('reads them after an existing step too', async () => {
    const built = await buildStep(stepForm('roundNumbers')!, engine, project(), 't', 0, [], []);
    expect(built.params.columns).toEqual(['id']);
  });

  it('starts from the columns the inspector already has, and from the selection over both', async () => {
    const known = [{ name: 'price', type: 'DOUBLE' }];
    expect((await buildStep(stepForm('roundNumbers')!, engine, project([]), 't', -1, known, [])).params.columns).toEqual(['price']);
    expect((await buildStep(stepForm('roundNumbers')!, engine, project([]), 't', -1, [], ['score'])).params.columns).toEqual(['score']);
  });

  it('gives no columns when the input cannot be read', async () => {
    const built = await buildStep(stepForm('roundNumbers')!, engine, project([]), 'missing', -1, [], []);
    expect(built.params.columns).toEqual([]);
  });
});
