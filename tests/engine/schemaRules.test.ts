// Rules derived from the schema on real DuckDB-WASM: a CSV that breaks each constraint of rules.dbml once.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileRules, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { invalidateCaches } from '../../src/flow/status';
import { setSchemaCheck, setSchemaDbml, type Project } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

const csv = src({ id: 'cust', format: 'csv' });
const DBML = readFileSync(join(__dirname, '../fixtures/dbml/rules.dbml'), 'utf8');

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(csv), new Uint8Array(readFileSync(join(__dirname, '../fixtures/schema-rules-customers.csv'))));
});
afterAll(() => engine.close());
beforeEach(() => invalidateCaches());

function checked(dbml = DBML): Project {
  const p = flow({ sources: [csv], nodes: [{ id: 'in', type: 'source', sourceId: csv.id }, { id: 'out', type: 'output' }], wires: [['in', 'out']] });
  return setSchemaCheck(setSchemaDbml(p, dbml), 'in', { schema: 'public', table: 'customers', mapping: {} });
}

/** Each derived rule's failing row count, by id. */
async function failures(p: Project): Promise<Record<string, number>> {
  const rules = p.nodes.find((n) => n.id === 'in')!.rules;
  const row = tableRows((await engine.query(compileRules(p, 'in', rules))).table)[0]!;
  return Object.fromEntries(rules.map((r, i) => [r.id, Number(row[`f${i}`])]));
}

describe('schema rules on data', () => {
  it('finds each broken constraint once', async () => {
    expect(await failures(checked())).toEqual({
      'schema-unique-id': 2,
      'schema-unique-email': 2,
      'schema-notEmpty-id': 0,
      'schema-readsAs-id': 0,
      'schema-notEmpty-email': 1,
      'schema-inSet-tier': 1,
      'schema-readsAs-age': 0,
      'schema-check-age-1': 1,
      'schema-readsAs-joined': 1,
    });
  });

  it('checks a column named differently in the data through the mapping', async () => {
    const p = checked(DBML.replace('tier tier', 'level tier'));
    const mapped = setSchemaCheck(p, 'in', { schema: 'public', table: 'customers', mapping: { level: 'tier' } });
    expect((await failures(mapped))['schema-inSet-level']).toBe(1);
  });
});
