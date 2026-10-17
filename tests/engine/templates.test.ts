// Node templates on real DuckDB-WASM (Node build): steps saved from a flow on tests/fixtures/customers.csv, inserted
// into other projects reading customers.csv again and contacts.csv (the same rows under other column names).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileDisplayPage, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { nodeById, type ColumnSchema, type Project, type Step, type TransformNode } from '../../src/model';
import { migrateTemplate } from '../../src/persistence/templates';
import { insertTemplate } from '../../src/templates/insert';
import { expectedColumns, mapSteps, suggestedMapping } from '../../src/templates/mapping';
import { createTemplate, type Template } from '../../src/templates/template';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const customers = src({ id: 'customers', format: 'csv' });
const contacts = src({ id: 'contacts', format: 'csv' });
type Source = typeof customers;

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  for (const [s, file] of [[customers, 'customers.csv'], [contacts, 'contacts.csv']] as const)
    await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, '../fixtures', file))));
});
afterAll(() => engine.close());

const steps: Step[] = [
  step('s1', 'trimWhitespace', { columns: ['name', 'email'] }),
  step('s2', 'changeCase', { columns: ['name'], mode: 'title' }),
  step('s3', 'changeCase', { columns: ['email'], mode: 'lower' }),
  step('s4', 'addColumn', { name: 'greeting', expression: "'Dear ' || name" }),
  step('s5', 'filterRows', { mode: 'remove', match: 'all', conditions: [{ column: 'email', op: 'empty', value: '' }], matchCase: false }),
];

/** A source wired into a Transform node `t` holding `withSteps`. */
const project = (source = customers, withSteps: Step[] = []) =>
  flow({
    sources: [source],
    nodes: [
      { id: 'in', type: 'source', sourceId: source.id },
      { id: 't', type: 'transform', steps: withSteps },
    ],
    wires: [['in', 't']],
  });

async function rows(p: Project, nodeId: string) {
  const schema = await engine.describe(compile(p, { nodeId }).sql);
  return tableRows((await engine.query(compileDisplayPage(p, { nodeId }, schema.map((c) => c.name), 0))).table);
}

const columnsOf = async (p: Project, nodeId: string): Promise<ColumnSchema[]> => engine.describe(compile(p, { nodeId }).sql);

/** Save `t`'s steps as a template the way the Save as template dialog does, through storage's JSON and migrations. */
async function save(): Promise<Template> {
  const input = await columnsOf(project(), 'in');
  const t = createTemplate({ name: 'Tidy contacts', steps, expectedColumns: expectedColumns(steps, input) });
  return migrateTemplate(JSON.parse(JSON.stringify(t)));
}

/** Insert a template after `in` in a project reading `source`, with columns mapped. */
async function insert(t: Template, source: Source, mapping: Record<string, string | undefined>) {
  const base = project(source);
  const actual = await columnsOf(base, 'in');
  const p = insertTemplate(base, t.name, mapSteps(t.steps, t.expectedColumns, actual, mapping), { x: 300, y: 0 }, 'in', 'tpl');
  return { p, node: nodeById(p, 'tpl') as TransformNode };
}

describe('node templates', () => {
  it('expects the input columns its steps read, and carries no row data', async () => {
    const t = await save();
    expect(t.expectedColumns).toEqual([
      { name: 'name', type: 'VARCHAR' },
      { name: 'email', type: 'VARCHAR' },
    ]);
    const text = JSON.stringify(t);
    for (const value of ['Lovelace', 'hopper', 'Dijkstra', 'example.com', '2024-01-31', 'not a date']) expect(text).not.toContain(value);
  });

  it('gives the same output as the original node on an input with the same columns', async () => {
    const original = await rows(project(customers, steps), 't');
    const { p } = await insert(await save(), customers, {});
    expect(await rows(p, 'tpl')).toEqual(original);
    expect(original.map((r) => r.greeting)).toEqual(['Dear Ada Lovelace', 'Dear Grace Hopper', 'Dear ']);
  });

  it('runs on columns mapped to other names, finding ones that differ only in case', async () => {
    const t = await save();
    const actual = await columnsOf(project(contacts), 'in');
    // Nothing reads "name" like "full_name", so it starts unmapped; Email is found as it is.
    expect(suggestedMapping(t.expectedColumns, actual)).toEqual({});
    const { p, node } = await insert(t, contacts, { name: 'full_name' });
    expect(node.steps.every((s) => s.enabled)).toBe(true);
    const original = await rows(project(customers, steps), 't');
    const mapped = await rows(p, 'tpl');
    expect(mapped.map((r) => [r.full_name, r.Email, r.greeting])).toEqual(original.map((r) => [r.name, r.email, r.greeting]));
  });

  it('turns off the steps whose columns stay unmapped, and the rest still run', async () => {
    const { p, node } = await insert(await save(), contacts, {});
    expect(node.steps.map((s) => s.enabled)).toEqual([false, false, true, false, true]);
    expect(node.steps[0]!.disabledReason).toMatch(/^Needs name, which the input doesn’t have/);
    const out = await rows(p, 'tpl');
    expect(out.map((r) => r.Email)).toEqual(['ada@example.com', 'grace@example.com ', 'null@example.com']);
    expect(Object.keys(out[0]!)).not.toContain('greeting');
  });
});
