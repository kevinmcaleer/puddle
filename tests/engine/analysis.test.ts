// Analysis on real DuckDB-WASM (Node build): the issues found in tests/fixtures/messy.csv and the messy text
// export, with their counts and examples, in a fixed number of queries.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyseNode, findIssues, issueKey, sortIssues } from '../../src/analysis';
import { sourceFileName } from '../../src/compiler';
import { EngineClient } from '../../src/engine/client';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

const messy = src({ id: 'messy', format: 'csv' });
const crm = src({ id: 'crm', format: 'csv', parseOptions: { delimiter: ';' } });

let engine: EngineClient;
let queries = 0;
beforeAll(async () => {
  const backend = await createNodeBackend();
  engine = new EngineClient(backend);
  const original = engine.query.bind(engine);
  engine.query = ((...args: Parameters<typeof original>) => (queries++, original(...args))) as typeof engine.query;
  await engine.registerBuffer(sourceFileName(messy), new Uint8Array(readFileSync(join(__dirname, '../fixtures/messy.csv'))));
  // The CRM export with its two comment lines and footer cut off, as the Skip rows read option will.
  const lines = readFileSync(join(__dirname, '../fixtures/messy/messy.txt'), 'utf8').split(/\r?\n/);
  await engine.registerBuffer(sourceFileName(crm), new TextEncoder().encode(lines.slice(2, -4).join('\n') + '\n'));
});
afterAll(() => engine.close());

const analyse = async (source: typeof messy) => {
  const project = flow({ sources: [source], nodes: [{ id: 'in', type: 'source', sourceId: source.id }] });
  const columns = await engine.describe(`SELECT * FROM (${(await import('../../src/compiler')).compile(project, { nodeId: 'in' }).sql}) LIMIT 0`);
  queries = 0;
  const analysis = await analyseNode(engine, project, 'in', columns);
  return { analysis, issues: sortIssues(findIssues(columns, analysis.profile, analysis.facts), columns.map((c) => c.name)) };
};

describe('analysing a node', () => {
  it('finds each of messy.csv’s problems in eight queries, with counts and examples from the data', async () => {
    const { issues, analysis } = await analyse(messy);
    // Count, profile, type sniff, the exact counts, the distinct values per column, the values of the few-valued columns, the rows out of line, and the shape of the text file.
    expect(queries).toBe(8);
    expect(analysis.facts.rows).toBe(5);
    // price (£1,234.50, (12.00), € 7,5) reads as numbers once symbols and brackets are allowed for; DuckDB reads joined (31/01/2024) as dates itself.
    expect(issues.map((i) => i.key)).toEqual(['duplicateRows', 'nonPrinting:name', 'edgeSpaces:name', 'doubleSpaces:name', 'emptyText:name', 'edgeSpaces:city', 'numbersAsText:price']);
    const by = Object.fromEntries(issues.map((i) => [i.key, i]));
    expect(by['numbersAsText:price']).toMatchObject({ count: 5, share: 1, severity: 'fix', fix: { type: 'parseNumbers', params: { decimal: '.', locale: '' } } });
    expect(by['edgeSpaces:name']).toMatchObject({ count: 2, examples: ['  ', '  ada   lovelace '], fix: { type: 'trimWhitespace' } });
    expect(by['nonPrinting:name']).toMatchObject({ count: 2, examples: ['edsger​dijkstra'] });
    expect(by['emptyText:name']).toMatchObject({ count: 1, fix: { type: 'emptyToNull' } });
    expect(by['duplicateRows']).toMatchObject({ count: 1, fix: { type: 'duplicateRows' } });
    expect(by['edgeSpaces:city']).toMatchObject({ count: 1, examples: ['  new york'] });
  });

  it('looks at a big table through its first rows, and says so', async () => {
    const project = flow({ sources: [messy], nodes: [{ id: 'in', type: 'source', sourceId: messy.id }] });
    const columns = await engine.describe(`SELECT * FROM (${(await import('../../src/compiler')).compile(project, { nodeId: 'in' }).sql}) LIMIT 0`);
    const analysis = await analyseNode(engine, project, 'in', columns, 3);
    expect(analysis.facts.sample).toEqual({ rows: 3, total: 5 });
    expect(analysis.facts.rows).toBe(3);
    const issues = findIssues(columns, analysis.profile, analysis.facts);
    expect(issues.every((i) => i.count <= 3)).toBe(true);
    // A table within the limit is looked at whole.
    expect((await analyseNode(engine, project, 'in', columns, 5)).facts.sample).toBeUndefined();
  });

  it('finds the CRM export’s duplicate rows, spaces, hidden characters, mixed capitals, placeholders, a misspelt city and text-typed columns', async () => {
    const { issues } = await analyse(crm);
    const keys = issues.map((i) => i.key);
    const by = Object.fromEntries(issues.map((i) => [i.key, i]));
    // The header pasted in again comes first (a shape issue, src/analysis/shape.ts), then the duplicates.
    expect(keys.slice(0, 2)).toEqual(['repeatedHeader', 'duplicateRows']);
    expect(issues[1]).toMatchObject({ count: 4, fix: { type: 'duplicateRows' } });
    for (const k of [issueKey('edgeSpaces', 'Customer Name'), issueKey('doubleSpaces', 'Customer Name'), issueKey('mixedCase', 'Customer Name'), issueKey('nonPrinting', 'City'), issueKey('mixedCase', 'Status'), issueKey('nonPrinting', 'Notes'), issueKey('edgeSpaces', 'Balance')])
      expect(keys, k).toContain(k);
    const status = issues.find((i) => i.key === issueKey('mixedCase', 'Status'))!;
    expect(status.examples).toEqual(['ACTIVE', 'Active', 'active']);
    // The placeholders (n/a, NULL) aside, Title and lower case tie among the spellings, and Title wins a tie.
    expect(status.fix).toEqual({ type: 'changeCase', params: { mode: 'title' } });
    const notes = issues.find((i) => i.key === issueKey('nonPrinting', 'Notes'))!;
    expect(notes.examples.some((e) => e.includes('\t') || e.includes('​'))).toBe(true);
    // Five ways of writing empty, as a read option since the node reads a text file.
    expect(by['placeholders:Status']).toMatchObject({ severity: 'fix', fix: { readOptions: { nullStrings: ['-', '?', 'N/A', 'NULL', 'n/a'] } } });
    expect(by['placeholders:Balance']).toMatchObject({ examples: ['n/a'], fix: { readOptions: { nullStrings: ['n/a'] } } });
    // Manchestr, once; the common spelling is offered in its place.
    expect(by['nearDuplicate:City:Manchestr']).toMatchObject({ severity: 'suggest', examples: ['Manchestr', 'Manchester'], fix: { type: 'replaceValues', params: { find: 'Manchestr', replace: 'Manchester' } } });
    // The customers' names are different people, not misspellings, though Fatima Patel and Fatima Ali share a start.
    expect(keys.filter((k) => k.startsWith('nearDuplicate'))).toEqual(['nearDuplicate:City:Manchestr']);
    // Amounts with brackets and a pound sign, dates in three formats: whole columns once the placeholders and blanks are set aside.
    expect(by['numbersAsText:Balance']).toMatchObject({ severity: 'fix', fix: { type: 'parseNumbers', params: { decimal: '.' } } });
    expect(by['datesAsText:Signed up']).toMatchObject({ severity: 'fix', fix: { type: 'parseDates' } });
    // Phone numbers written three ways, with no safe fix: only noted.
    expect(by['inconsistentShapes:Phone']).toMatchObject({ severity: 'info', examples: ['+99 9999 999999', '99999 999999', '99999999999'] });
    expect(keys.filter((k) => k.startsWith('idDuplicates') || k.startsWith('constantColumn') || k.startsWith('indexColumn') || k === 'untidyNames')).toEqual([]);
  });
});
