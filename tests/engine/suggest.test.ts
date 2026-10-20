// Suggested rules on real DuckDB-WASM (Node build): what customers.csv and messy.csv suggest, and that every
// suggestion, once added, passes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileRules, compileSuggestionChecks, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import type { Project, Rule, Source } from '../../src/model';
import { gatherSuggestionFacts, suggestRules, type Suggestion } from '../../src/rules';
import { ruleLabel } from '../../src/rules/forms';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

const cust = src({ id: 'cust', format: 'csv' });
const messy = src({ id: 'messy', format: 'csv' });
const statuses = src({ id: 'statuses', format: 'csv' });
const STATUSES = 'id,status,amount,due\n1,open,10.5,2024-01-02\n2,closed,3,2024-02-03\n3,open,7.25,2024-03-04\n4,pending,1,2024-04-05\n5,closed,2,2024-05-06\n6,open,4,2024-06-07\n7,open,5,2024-07-08\n';

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  for (const [s, file] of [[cust, 'customers.csv'], [messy, 'messy.csv']] as const)
    await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, '../fixtures', file))));
  await engine.registerText(sourceFileName(statuses), STATUSES);
});
afterAll(() => engine.close());

/** A source and a Transform after it (with `steps`); suggestions are for the Transform's output. */
const single = (source: Source, steps: ReturnType<typeof step>[] = []): Project =>
  flow({ sources: [source], nodes: [{ id: 'in', type: 'source', sourceId: source.id }, { id: 'out', type: 'transform', steps }], wires: [['in', 'out']] });

async function suggest(source: Source, steps: ReturnType<typeof step>[] = []) {
  const project = single(source, steps);
  const columns = await engine.describe(compile(project, { nodeId: 'out' }).sql);
  const facts = await gatherSuggestionFacts(engine, project, 'out', columns);
  return { project, suggestions: suggestRules(columns, facts.profile, facts.checked) };
}

const brief = (s: Suggestion[]) => s.map((x) => `${ruleLabel(x)} | ${x.reason}`);

/** Add every suggestion as a rule and check them all in one pass: each one should pass on the data it came from. */
async function failuresOnceAdded(project: Project, suggestions: Suggestion[]) {
  const rules: Rule[] = suggestions.map((s, i) => ({ id: `r${i}`, type: s.type, label: s.key, enabled: true, severity: 'fail', params: s.params }));
  const row = tableRows((await engine.query(compileRules(project, 'out', rules))).table)[0]!;
  return Object.fromEntries(suggestions.map((s, i) => [s.key, Number(row[`f${i}`])]));
}

describe('suggested rules on fixtures', () => {
  it('customers.csv: a unique, never empty id in a range; distinct names; joined is always filled and unpadded', async () => {
    const { project, suggestions } = await suggest(cust);
    expect(brief(suggestions)).toEqual([
      'id is never empty | id has no empty values',
      'id is unique | id has a different value in each of its 4 rows',
      'id is between 1 and 4 | id runs from 1 to 4',
      // Padded and blank as some names are, no two are the same.
      'name is unique | name has a different value in each of its 4 rows',
      'joined is never empty | joined has no empty values',
      'joined is unique | joined has a different value in each of its 4 rows',
      'No leading or trailing spaces in joined | joined has no spaces at either end',
    ]);
    expect(Object.values(await failuresOnceAdded(project, suggestions)).every((f) => f === 0)).toBe(true);
  });

  it('messy.csv: a duplicated id is never suggested as unique; padded names and blanks suggest nothing', async () => {
    const { project, suggestions } = await suggest(messy);
    const keys = suggestions.map((s) => s.key);
    expect(keys).not.toContain('unique:id');
    expect(keys.filter((k) => /:(name|city)$/.test(k))).toEqual([]);
    expect(brief(suggestions)).toEqual([
      'id is never empty | id has no empty values',
      'id is between 1 and 4 | id runs from 1 to 4',
      'price is never empty | price has no empty values',
      'price reads as a number | price is text, but every value reads as a number',
      'No leading or trailing spaces in price | price has no spaces at either end',
      'joined is never empty | joined has no empty values',
      'joined is between 2024-01-31 and 2024-12-25 | joined runs from 2024-01-31 to 2024-12-25',
    ]);
    expect(Object.values(await failuresOnceAdded(project, suggestions)).every((f) => f === 0)).toBe(true);
  });

  it('few distinct values suggest a set, listing them; numbers and dates stored as text suggest reading them so', async () => {
    const { project, suggestions } = await suggest(statuses, [step('t1', 'changeType', { columns: ['amount', 'due'], to: 'text' })]);
    const set = suggestions.find((s) => s.key === 'inSet:status')!;
    expect(set.params.values).toEqual(['closed', 'open', 'pending']);
    expect(set.reason).toBe('status has 3 distinct values');
    expect(brief(suggestions.filter((s) => s.type === 'readsAs'))).toEqual([
      'amount reads as a number | amount is text, but every value reads as a number',
      'due reads as a date | due is text, but every value reads as a date',
    ]);
    expect(Object.values(await failuresOnceAdded(project, suggestions)).every((f) => f === 0)).toBe(true);
  });

  it('confirms the approximate distinct count with an exact one before suggesting unique', async () => {
    const project = single(cust);
    const sql = compileSuggestionChecks(project, { nodeId: 'out' }, [{ column: 'id', distinct: true }]);
    expect(sql).toContain('count(DISTINCT "id")');
    const row = tableRows((await engine.query(sql)).table)[0]!;
    expect(Number(row.distinct0)).toBe(4);
  });
});
