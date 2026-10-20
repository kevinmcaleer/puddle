// The shape issues on real DuckDB-WASM: the two messy text fixtures open with the options their sniff chose (a
// banner, comment lines and a footer skipped), their rows that aren't data are each an issue with a fix, and Fix all
// leaves the table.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyseNode, findIssues, isStepFix, planFixes, sortIssues, type Issue } from '../../src/analysis';
import { compile, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { placeFixes, setParseOptions, type Project } from '../../src/model';
import { sniff } from '../../src/sources/sniff';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
});
afterAll(() => engine.close());

/** The fixture as Puddle adds it: sniffed, registered, one source node. */
async function open(name: string) {
  const data = new Uint8Array(readFileSync(join(__dirname, '../fixtures/messy', name)));
  const sniffed = sniff({ name, head: data, size: data.length });
  const source = src({ id: name.replace(/\W/g, '_'), format: sniffed.format, parseOptions: sniffed.parseOptions });
  await engine.registerBuffer(sourceFileName(source), data);
  return { sniffed, project: flow({ sources: [source], nodes: [{ id: 'in', type: 'source', sourceId: source.id }] }), sourceId: source.id };
}

const analyse = async (project: Project, nodeId: string) => {
  const columns = await engine.describe(`SELECT * FROM (${compile(project, { nodeId }).sql}) LIMIT 0`);
  const analysis = await analyseNode(engine, project, nodeId, columns);
  return { columns, analysis, issues: sortIssues(findIssues(columns, analysis.profile, analysis.facts), columns.map((c) => c.name)) };
};

/** Apply the chosen issues' fixes as Fix all does: read options on the source first, then the steps after the node. */
async function fixAll(project: Project, sourceId: string, chosen: (issues: Issue[]) => Issue[]) {
  const before = await analyse(project, 'in');
  const { steps, readOptions } = await planFixes(chosen(before.issues), { available: before.columns, locale: project.settings.locale });
  let fixed = project;
  if (Object.keys(readOptions).length) fixed = setParseOptions(fixed, sourceId, { ...fixed.sources[0]!.parseOptions, ...readOptions });
  const placed = placeFixes(fixed, 'in', steps);
  const target = placed ? { project: placed.project, nodeId: placed.last.nodeId } : { project: fixed, nodeId: 'in' };
  const rows = tableRows((await engine.query(compile(target.project, { nodeId: target.nodeId }).sql)).table);
  return { before, steps, readOptions, after: await analyse(target.project, target.nodeId), rows };
}

const keys = (issues: Issue[]) => issues.map((i) => i.key);
const fixOf = (issues: Issue[], key: string) => issues.find((i) => i.key === key)?.fix;

describe('messy.txt: comment lines, a footer, a header pasted in again, blank and ragged rows', () => {
  it('opens with the comment lines and the footer skipped, named from its header, and lists the pasted-in header and the duplicates', async () => {
    const { sniffed, project } = await open('messy.txt');
    expect(sniffed.parseOptions).toEqual({
      delimiter: ';',
      skip: 2,
      skipBottom: 1,
      columns: ['Customer ID', 'Customer Name', 'City', 'Status', 'Signed up', 'Balance', 'Phone', 'Notes'],
    });
    const { columns, analysis, issues } = await analyse(project, 'in');
    expect(columns.map((c) => c.name)).toEqual(sniffed.parseOptions.columns);
    // 44 data rows and the header again; the blank lines are never rows, and the row count at the end is skipped.
    expect(analysis.facts.rows).toBe(45);
    expect(analysis.facts.shape?.facts).toMatchObject({ rows: 45, header: 1, blank: 0, narrow: 0, separator: 0, total: 0, top: 0, bottom: 0 });
    expect(keys(issues).slice(0, 2)).toEqual(['repeatedHeader', 'duplicateRows']);
    expect(fixOf(issues, 'repeatedHeader')).toEqual({
      type: 'filterRows',
      params: { mode: 'remove', match: 'all', matchCase: true, conditions: [{ column: 'Customer ID', op: 'equals', value: 'Customer ID' }, { column: 'Customer Name', op: 'equals', value: 'Customer Name' }] },
    });
    expect(issues.find((i) => i.key === 'duplicateRows')?.count).toBe(4);
  });

  it('Fix all leaves the 40 customers clean; without Remove duplicates, the 44 rows', async () => {
    const { project, sourceId } = await open('messy.txt');
    const all = await fixAll(project, sourceId, (issues) => issues.filter((i) => i.severity === 'fix'));
    expect(all.readOptions).toEqual({});
    expect(all.steps.map((s) => s.type)).toEqual(['removeNonPrinting', 'trimWhitespace', 'collapseSpaces', 'filterRows', 'changeCase', 'changeCase', 'duplicateRows']);
    expect(all.rows).toHaveLength(40);
    expect(all.after.issues.filter((i) => i.severity === 'fix')).toEqual([]);
    expect(all.rows[0]).toMatchObject({ 'Customer ID': 'CU1000', 'Customer Name': 'Kofi Jones', City: 'Cardiff' });
    expect(all.rows[39]).toMatchObject({ 'Customer ID': 'CU1039', 'Customer Name': 'Dev Smith' });

    const keep = await fixAll(project, sourceId, (issues) => issues.filter((i) => i.severity === 'fix' && !(isStepFix(i.fix) && i.fix.type === 'duplicateRows')));
    expect(keep.rows).toHaveLength(44);
  });
});

describe('sap-extract.txt: a banner, separator lines, a page break, a repeated header, a total row and a footer', () => {
  it('opens with the banner and the footer skipped, the empty edge columns named, and each kind of non-data row an issue with a fix', async () => {
    const { sniffed, project } = await open('sap-extract.txt');
    expect(sniffed.parseOptions).toEqual({
      delimiter: '|',
      header: true,
      encoding: 'latin-1',
      skip: 5,
      skipBottom: 3,
      columns: ['column0', 'Doc. no.', 'Vendor', 'Doc. date', 'Pstng date', 'Crcy', 'Amount in LC', 'Cost ctr', 'Text', 'column9'],
    });
    const { analysis, issues } = await analyse(project, 'in');
    expect(analysis.facts.rows).toBe(70);
    expect(analysis.facts.shape?.facts).toMatchObject({ header: 1, total: 1, totalEx: ['*'], totalCol: 'Doc. no.', bottom: 0 });
    expect(keys(issues).slice(0, 3)).toEqual(['repeatedHeader', 'narrowRows', 'totalRows']);
    // Separator lines, the second page's banner: rows with nothing past the first column.
    const narrow = issues.find((i) => i.key === 'narrowRows')!;
    expect(narrow.count).toBe(8);
    expect(narrow.examples).toEqual(['------------']);
    expect(narrow.fix).toMatchObject({ type: 'filterRows', params: { mode: 'remove', match: 'all' } });
    // The total row is a suggestion: it may be wanted.
    const total = issues.find((i) => i.key === 'totalRows')!;
    expect(total.severity).toBe('suggest');
    expect(total.fix).toEqual({ type: 'filterRows', params: { mode: 'remove', match: 'any', matchCase: false, conditions: [{ column: 'Doc. no.', op: 'startsWith', value: '*' }] } });
  });

  it('Fix all with the total row leaves the 60 line items, umlauts intact', async () => {
    const { project, sourceId } = await open('sap-extract.txt');
    const { rows, after } = await fixAll(project, sourceId, (issues) => issues.filter((i) => i.severity === 'fix' || i.kind === 'totalRows'));
    expect(rows).toHaveLength(60);
    expect(rows.map((r) => r['Vendor'])).toContain('Müller GmbH');
    // With the asterisk gone, the document numbers are all digits: that one is a fix now, for the next Fix all.
    expect(keys(after.issues.filter((i) => i.severity === 'fix'))).toEqual(['numbersAsText:Doc. no.']);
  });
});
