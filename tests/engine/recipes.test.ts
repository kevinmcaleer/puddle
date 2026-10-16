// Recipes on real DuckDB-WASM (Node build): each gallery recipe in public/recipes opened as a project, its sources
// attached to files with the columns it expects (tests/fixtures/recipes), and every node run; then a recipe fitted to
// a file whose columns differ, through the column mapping.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileDisplayPage, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { evaluateFlow, invalidateCaches, useFlowStore } from '../../src/flow/status';
import { type Project, type TransformNode } from '../../src/model';
import { matchSource } from '../../src/recipes/match';
import { projectFromRecipe, readRecipe, recipeFromProject, writeRecipe } from '../../src/recipes/recipe';
import { missingColumns, suggestedMapping } from '../../src/templates/mapping';
import { createNodeBackend } from '../helpers/nodeBackend';

const gallery = (file: string) => {
  const r = readRecipe(readFileSync(join(__dirname, '../../public/recipes', file), 'utf8'));
  if (r.kind !== 'pipeline') throw new Error('expected a pipeline');
  return projectFromRecipe(r);
};

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

/** Attach a fixture to a source the way choosing a file does: registered under the source's file name. */
const sourceNamed = (p: Project, name: string) => p.sources.find((s) => s.name === name)!;

async function attach(p: Project, name: string, fixture: string) {
  const source = sourceNamed(p, name);
  await engine.registerBuffer(sourceFileName(source), new Uint8Array(readFileSync(join(__dirname, '../fixtures', fixture))));
}

const columnsOf = (p: Project, nodeId: string) => engine.describe(compile(p, { nodeId }).sql);

async function rows(p: Project, nodeId: string) {
  const schema = await columnsOf(p, nodeId);
  return tableRows((await engine.query(compileDisplayPage(p, { nodeId }, schema.map((c) => c.name), 0, 1000))).table);
}

/** Every node runs, evaluated the way the canvas does it. */
async function runsThrough(p: Project) {
  invalidateCaches();
  await evaluateFlow(engine, p);
  const statuses = useFlowStore.getState().nodes;
  expect(Object.fromEntries(p.nodes.map((n) => [n.id, statuses[n.id]?.status.state]))).toEqual(Object.fromEntries(p.nodes.map((n) => [n.id, 'ok'])));
}

/** The source's columns as read, matched against what the recipe expects: nothing missing. */
async function fits(p: Project, name: string) {
  const source = sourceNamed(p, name);
  const node = p.nodes.find((n) => n.type === 'source' && n.sourceId === source.id)!;
  expect(missingColumns(source.expected!, await columnsOf(p, node.id))).toEqual([]);
}

describe('gallery recipes on files with the columns they expect', () => {
  it('tidy a contact list', async () => {
    const p = gallery('tidy-contact-list.puddle-recipe.json');
    await attach(p, 'Contact list', 'recipes/contacts.csv');
    await fits(p, 'Contact list');
    await runsThrough(p);
    const out = await rows(p, 'n_out');
    expect(out.length).toBe(48);
    expect(out[0]).toMatchObject({ name: 'Alice Patel', email: 'alice.patel@example.com', city: 'Manchester' });
    expect(out.some((r) => String(r.name).includes('  '))).toBe(false);
  });

  it('standardise dates and currencies', async () => {
    const p = gallery('standardise-dates-and-currencies.puddle-recipe.json');
    await attach(p, 'Sales', 'recipes/sales.csv');
    await fits(p, 'Sales');
    await runsThrough(p);
    const types = Object.fromEntries((await columnsOf(p, 'n_out')).map((c) => [c.name, c.type]));
    expect(types).toMatchObject({ order_date: 'DATE', amount: 'DOUBLE', currency: 'VARCHAR' });
    const out = await rows(p, 'n_out');
    // The results table reads every value as text.
    expect(out.slice(0, 6).map((r) => [r.order_date, r.amount, r.currency])).toEqual([
      ['2024-05-28', '132.49', 'GBP'],
      ['2024-01-24', '1530.44', 'GBP'],
      ['2024-02-16', '2327.05', 'GBP'],
      ['2024-11-18', '496.63', 'EUR'],
      ['2024-12-18', '219.33', 'GBP'],
      ['2024-04-28', '1786.34', 'GBP'],
    ]);
    expect(out.every((r) => r.order_date != null)).toBe(true);
  });

  it('deduplicate customers', async () => {
    const p = gallery('deduplicate-customers.puddle-recipe.json');
    await attach(p, 'Orders', 'recipes/orders.csv');
    await attach(p, 'Customers', 'recipes/customers.csv');
    await fits(p, 'Orders');
    await fits(p, 'Customers');
    await runsThrough(p);
    const customers = await rows(p, 'n_dedupe');
    expect(new Set(customers.map((r) => r.customer_id)).size).toBe(customers.length);
    const out = await rows(p, 'n_out');
    expect(out.length).toBe(60);
    // Ids written "C004 " and "c017" now find their customer; C099 and C120 aren't listed.
    expect(out.filter((r) => r.name == null).map((r) => r.customer_id).sort()).toEqual(['C099', 'C120']);
  });

  it('monthly sales summary', async () => {
    const p = gallery('monthly-sales-summary.puddle-recipe.json');
    await attach(p, 'Monthly sales', 'recipes/monthly-sales.csv');
    await fits(p, 'Monthly sales');
    await runsThrough(p);
    const out = await rows(p, 'n_out');
    expect(out.map((r) => r.month).sort()).toEqual(['apr_2024', 'aug_2024', 'dec_2024', 'feb_2024', 'jan_2024', 'jul_2024', 'jun_2024', 'mar_2024', 'may_2024', 'nov_2024', 'oct_2024', 'sep_2024']);
    expect(out.every((r) => Number(r['sum of sales']) > 0)).toBe(true);
    expect((await columnsOf(p, 'n_out')).find((c) => c.name === 'sum of sales')?.type).toBe('DOUBLE');
  });
});

describe('a recipe fitted to a file whose columns differ', () => {
  it('runs with mapped columns renamed back, and steps reading an unmapped column turned off', async () => {
    let p = gallery('tidy-contact-list.puddle-recipe.json');
    // tests/fixtures/contacts.csv: id, full_name, Email, joined. Email is found under another case; no city.
    await attach(p, 'Contact list', 'contacts.csv');
    const actual = await columnsOf(p, 'n_contacts');
    expect(missingColumns(p.sources[0]!.expected!, actual).map((m) => m.expected.name)).toEqual(['name', 'city']);
    expect(suggestedMapping(p.sources[0]!.expected!, actual)).toEqual({});
    p = matchSource(p, sourceNamed(p, 'Contact list').id, actual, { name: 'full_name' });
    const tidy = p.nodes.find((n) => n.id === 'n_tidy') as TransformNode;
    expect(tidy.steps.filter((s) => !s.enabled).map((s) => s.id)).toEqual(['st_city_trim', 'st_city']);
    await runsThrough(p);
    const out = await rows(p, 'n_out');
    expect(out.map((r) => [r.name, r.email])).toEqual([
      ['Ada Lovelace', 'ada@example.com'],
      ['Grace Hopper', 'grace@example.com'],
      ['Edsger W. Dijkstra', null],
      ['', 'null@example.com'],
    ]);
  });
});

describe('a recipe exported from a working project', () => {
  it('opens and runs again on the same file, and holds none of its rows', async () => {
    let p = gallery('standardise-dates-and-currencies.puddle-recipe.json');
    await attach(p, 'Sales', 'recipes/sales.csv');
    p = matchSource(p, sourceNamed(p, 'Sales').id, await columnsOf(p, 'n_sales'), {});
    const text = writeRecipe(recipeFromProject(p, { name: 'Again', description: '' }));
    for (const value of ['Omar Okafor', 'SO-1001', '1530.44', 'Briggate']) expect(text).not.toContain(value);
    const r = readRecipe(text);
    if (r.kind !== 'pipeline') throw new Error('expected a pipeline');
    const again = projectFromRecipe(r);
    await attach(again, 'Sales', 'recipes/sales.csv');
    expect(await rows(again, 'n_out')).toEqual(await rows(p, 'n_out'));
  });
});
