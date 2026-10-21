// The shape issues on real DuckDB-WASM: the two messy text fixtures open with the options their sniff chose (a
// banner, comment lines and a footer skipped), their rows that aren't data are each an issue with a fix, and Fix all
// leaves the table.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyseNode, findIssues, isStepFix, planFixes, sortIssues, type Issue } from '../../src/analysis';
import { compile, sourceFileName } from '../../src/compiler';
import { detectDateFormats } from '../../src/dates';
import { EngineClient, tableRows } from '../../src/engine/client';
import { placeFixes, setParseOptions, type Project } from '../../src/model';
import { sniff } from '../../src/sources/sniff';
import { decodeText, isRewrittenTextSource, readText, rewrittenCsv } from '../../src/sources/text';
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
  // A pipe table or fixed-width text is read into rows first and handed to DuckDB as CSV (src/sources/rewrite.ts).
  if (isRewrittenTextSource(source)) await engine.registerText(sourceFileName(source), rewrittenCsv(readText(source.format, decodeText(data, source.parseOptions.encoding), source.parseOptions)));
  else await engine.registerBuffer(sourceFileName(source), data);
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
  const { steps, readOptions } = await planFixes(chosen(before.issues), { available: before.columns, locale: project.settings.locale, detectDates: (column) => detectDateFormats(engine, project, { nodeId: 'in' }, column) });
  let fixed = project;
  if (Object.keys(readOptions).length) {
    fixed = setParseOptions(fixed, sourceId, { ...fixed.sources[0]!.parseOptions, ...readOptions });
    const source = fixed.sources[0]!;
    if (isRewrittenTextSource(source)) {
      const data = new Uint8Array(readFileSync(join(__dirname, '../fixtures/messy', source.name)));
      await engine.registerText(sourceFileName(source), rewrittenCsv(readText(source.format, decodeText(data, source.parseOptions.encoding), source.parseOptions)));
    }
  }
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

  it('Fix all leaves the 40 customers clean and typed; without Remove duplicates, the 44 rows', async () => {
    const { project, sourceId } = await open('messy.txt');
    const all = await fixAll(project, sourceId, (issues) => issues.filter((i) => i.severity === 'fix'));
    // The five ways of writing empty are read as empty, so the balance and the status are whole columns.
    expect(all.readOptions).toEqual({ nullStrings: ['-', '?', 'N/A', 'NULL', 'n/a'] });
    expect(all.steps.map((s) => s.type)).toEqual(['removeNonPrinting', 'trimWhitespace', 'collapseSpaces', 'filterRows', 'changeCase', 'parseNumbers', 'parseDates', 'duplicateRows']);
    expect(all.rows).toHaveLength(40);
    expect(all.after.issues.filter((i) => i.severity === 'fix')).toEqual([]);
    expect(all.rows[0]).toMatchObject({ 'Customer ID': 'CU1000', 'Customer Name': 'Kofi Jones', City: 'Cardiff', Balance: -4923.54 });
    expect(all.rows[39]).toMatchObject({ 'Customer ID': 'CU1039', 'Customer Name': 'Dev Smith' });
    expect(all.after.columns.find((c) => c.name === 'Balance')?.type).toBe('DOUBLE');
    expect(all.after.columns.find((c) => c.name === 'Signed up')?.type).toBe('DATE');
    expect(all.rows.filter((r) => r['Status'] == null).length).toBeGreaterThan(0);
    // The misspelt city is a suggestion; ticked, it is put right.
    const withTypo = await fixAll(project, sourceId, (issues) => issues.filter((i) => i.severity === 'fix' || i.kind === 'nearDuplicate'));
    expect(withTypo.steps.map((s) => s.type)).toContain('replaceValues');
    expect(withTypo.rows.map((r) => r['City'])).not.toContain('Manchestr');
    expect(withTypo.rows.filter((r) => r['City'] === 'Manchester').length).toBeGreaterThan(all.rows.filter((r) => r['City'] === 'Manchester').length);

    const keep = await fixAll(project, sourceId, (issues) => issues.filter((i) => i.severity === 'fix' && !(isStepFix(i.fix) && i.fix.type === 'duplicateRows')));
    expect(keep.rows).toHaveLength(44);
  });
});

describe('sap-extract.txt: a banner, separator lines, a page break, a repeated header, a total row and a footer', () => {
  it('opens as a pipe table: eight named columns, the banner, rules, page header and footer left out, the total row a suggestion', async () => {
    const { sniffed, project } = await open('sap-extract.txt');
    expect(sniffed).toMatchObject({ format: 'pipes', parseOptions: { encoding: 'latin-1' } });
    const { columns, analysis, issues } = await analyse(project, 'in');
    expect(columns.map((c) => c.name)).toEqual(['Doc. no.', 'Vendor', 'Doc. date', 'Pstng date', 'Crcy', 'Amount in LC', 'Cost ctr', 'Text']);
    // 60 line items and the total row: the reader keeps every row between pipes that isn't a rule or the header again.
    expect(analysis.facts.rows).toBe(61);
    expect(analysis.facts.shape?.facts).toMatchObject({ header: 0, narrow: 0, total: 1, totalEx: ['*'], totalCol: 'Doc. no.', bottom: 0 });
    expect(keys(issues)).not.toContain('repeatedHeader');
    expect(keys(issues)).not.toContain('narrowRows');
    // The total row is a suggestion: it may be wanted.
    const total = issues.find((i) => i.key === 'totalRows')!;
    expect(total.severity).toBe('suggest');
    expect(total.fix).toEqual({ type: 'filterRows', params: { mode: 'remove', match: 'any', matchCase: false, conditions: [{ column: 'Doc. no.', op: 'startsWith', value: '*' }] } });
  });

  it('Fix all with the total row leaves the 60 line items typed, umlauts intact, German amounts read with a comma', async () => {
    const { project, sourceId } = await open('sap-extract.txt');
    const { before, steps, rows, after } = await fixAll(project, sourceId, (issues) => issues.filter((i) => i.severity === 'fix' || i.kind === 'totalRows'));
    // The amounts are read with a comma for the decimal mark, as the column writes them, whatever the project's locale.
    expect(before.issues.find((i) => i.key === 'numbersAsText:Amount in LC')).toMatchObject({ severity: 'fix', fix: { type: 'parseNumbers', params: { decimal: ',', locale: '' } } });
    // DuckDB reads the day-first dates itself from the rewritten CSV, so no Parse dates step is needed.
    expect(before.columns.find((c) => c.name === 'Doc. date')?.type).toBe('DATE');
    expect(steps.map((s) => s.type)).toEqual(['filterRows', 'parseNumbers']);
    expect(rows).toHaveLength(60);
    expect(rows.map((r) => r['Vendor'])).toContain('Müller GmbH');
    expect(rows[0]).toMatchObject({ 'Amount in LC': 891.36 });
    // A trailing minus is a negative, as SAP writes them.
    expect(rows.some((r) => (r['Amount in LC'] as number) < 0)).toBe(true);
    expect(Math.round(rows.reduce((sum, r) => sum + (r['Amount in LC'] as number), 0) * 100) / 100).toBe(192474.66);
    expect(after.columns.find((c) => c.name === 'Doc. date')?.type).toBe('DATE');
    // With the asterisk gone, the document numbers are all digits: a fix for the next Fix all.
    expect(keys(after.issues.filter((i) => i.severity === 'fix'))).toEqual(['numbersAsText:Doc. no.']);
  });
});
