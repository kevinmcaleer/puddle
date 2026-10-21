// Skewed rows (#188) on real DuckDB-WASM: the two sheets of skewed.xlsx, where a cell was deleted or inserted part
// way down, each list one issue naming the shifted rows, and Fix all moves the cells back and gives the columns
// their types; then Realign rows by hand on a CSV.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyseNode, findIssues, planFixes, sortIssues, type Issue } from '../../src/analysis';
import { useEngineStore } from '../../src/app/engine';
import { compile, sourceFileName } from '../../src/compiler';
import { detectDateFormats } from '../../src/dates';
import { EngineClient, tableRows } from '../../src/engine/client';
import { inProcessClient, setExcelClient } from '../../src/excel/client';
import { ExcelService } from '../../src/excel/service';
import { createProject, placeFixes, setParseOptions, useProjectStore, type Project } from '../../src/model';
import { addFileSource } from '../../src/sources/add';
import { useAttachments } from '../../src/sources/attachments';
import { resetExcelSources, syncExcelSources, withSheet } from '../../src/sources/excel';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src, step } from '../helpers/projects';

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
});
afterAll(() => engine.close());
beforeEach(() => {
  setExcelClient(inProcessClient(new ExcelService()));
  resetExcelSources();
  useAttachments.setState({ sources: {} });
  useProjectStore.getState().load(createProject('Skewed'));
});
afterEach(() => setExcelClient(undefined));

const project = () => useProjectStore.getState().history.present;

/** The workbook as Puddle adds it, on the sheet named, read into DuckDB. */
async function openSheet(sheet: string) {
  const bytes = readFileSync(join(__dirname, '../fixtures/messy/skewed.xlsx'));
  const s = await addFileSource(new File([bytes], 'skewed.xlsx'));
  useProjectStore.getState().apply((p) => setParseOptions(p, s.id, withSheet(p.sources.find((x) => x.id === s.id)!.parseOptions, sheet)));
  await syncExcelSources(engine, project());
  const p = project();
  return { project: p, nodeId: p.nodes.find((n) => n.type === 'source' && n.sourceId === s.id)!.id };
}

async function analyse(p: Project, nodeId: string) {
  const columns = await engine.describe(`SELECT * FROM (${compile(p, { nodeId }).sql}) LIMIT 0`);
  const analysis = await analyseNode(engine, p, nodeId, columns);
  const issues = sortIssues(findIssues(columns, analysis.profile, analysis.facts), columns.map((c) => c.name));
  return { columns, analysis, issues };
}

/** Fix all: the fixes of the issues chosen, placed after the node, and the result read back. */
async function fixAll(p: Project, nodeId: string, chosen: (issues: Issue[]) => Issue[]) {
  const before = await analyse(p, nodeId);
  const { steps } = await planFixes(chosen(before.issues), { available: before.columns, locale: p.settings.locale, detectDates: (c) => detectDateFormats(engine, p, { nodeId }, c) });
  const placed = placeFixes(p, nodeId, steps)!;
  const sql = compile(placed.project, { nodeId: placed.last.nodeId }).sql;
  const columns = await engine.describe(`SELECT * FROM (${sql}) LIMIT 0`);
  const rows = tableRows((await engine.query(sql)).table);
  return { before, steps, columns, rows, after: await analyse(placed.project, placed.last.nodeId) };
}

const type = (columns: { name: string; type: string }[], name: string) => columns.find((c) => c.name === name)?.type;
const fixes = (issues: Issue[]) => issues.filter((i) => i.severity === 'fix');
/** Every invoice's gross is its net plus its VAT, once the cells are back where they belong. */
const consistent = (rows: Record<string, unknown>[]) => rows.every((r) => typeof r.Net === 'number' && typeof r.VAT === 'number' && Math.abs((r.Net as number) + (r.VAT as number) - (r.Gross as number)) < 0.011);

describe('skewed.xlsx', () => {
  it('Deleted cell: from the 18th row the cells sit a column left; the one issue says so, and Fix all moves them back', async () => {
    const { project: p, nodeId } = await openSheet('Deleted cell');
    const { columns, issues, analysis } = await analyse(p, nodeId);
    expect(columns.map((c) => c.name)).toEqual(['Invoice', 'Customer', 'Issued', 'Due', 'Net', 'VAT', 'Gross']);
    expect(analysis.facts.skew?.skew).toMatchObject({ at: 1, sit: 'left', rows: { from: 18 }, exact: true, shifted: { n: 19, first: 18, last: 36 } });
    const skew = issues.find((i) => i.kind === 'skewedRows')!;
    expect(skew).toMatchObject({ key: 'skewedRows:Customer:left', column: 'Customer', count: 19, severity: 'fix', examples: ['rows 18 to 36', 'from row 18'] });
    // The columns the cells moved through are not each an issue of their own: the one fix covers them.
    expect(issues.filter((i) => i.severity === 'fix').map((i) => i.key)).toEqual(['skewedRows:Customer:left']);

    const { steps, columns: after, rows, after: again } = await fixAll(p, nodeId, fixes);
    expect(steps.map((s) => s.type)).toEqual(['realignRows', 'parseNumbers', 'parseDates', 'parseDates']);
    expect(rows).toHaveLength(36);
    expect(['Issued', 'Due'].map((c) => type(after, c))).toEqual(['DATE', 'DATE']);
    expect(['Net', 'VAT', 'Gross'].map((c) => type(after, c))).toEqual(['DOUBLE', 'DOUBLE', 'DOUBLE']);
    expect(consistent(rows)).toBe(true);
    // The deleted customer is gone for good: those rows have an empty Customer, nothing made up.
    expect(rows.slice(17).every((r) => r.Customer == null)).toBe(true);
    expect(rows.slice(0, 17).every((r) => typeof r.Customer === 'string')).toBe(true);
    expect(rows.every((r) => r.Issued != null && r.Due != null)).toBe(true);
    expect(again.issues.find((i) => i.kind === 'skewedRows')).toBeUndefined();
  });

  it('Inserted cell: a block in the middle sits a column right, pushing a nameless column out; Fix all moves it back and drops that column', async () => {
    const { project: p, nodeId } = await openSheet('Inserted cell');
    const { columns, issues, analysis } = await analyse(p, nodeId);
    expect(columns.map((c) => c.name)).toEqual(['Invoice', 'Customer', 'Issued', 'Due', 'Net', 'VAT', 'Gross', 'Column H']);
    expect(analysis.facts.skew?.skew).toMatchObject({ at: 2, sit: 'right', rows: { emptyColumn: 2 }, exact: true, shifted: { n: 12, first: 11, last: 22 } });
    expect(issues.find((i) => i.kind === 'skewedRows')).toMatchObject({ key: 'skewedRows:Issued:right', count: 12, severity: 'fix', examples: ['rows 11 to 22', 'where Issued is empty'] });

    const { steps, columns: after, rows } = await fixAll(p, nodeId, fixes);
    expect(steps.map((s) => s.type)).toEqual(['realignRows', 'parseNumbers', 'parseDates', 'parseDates', 'removeColumns']);
    expect(after.map((c) => c.name)).toEqual(['Invoice', 'Customer', 'Issued', 'Due', 'Net', 'VAT', 'Gross']);
    expect(rows).toHaveLength(36);
    expect(['Issued', 'Due', 'Net'].map((c) => type(after, c))).toEqual(['DATE', 'DATE', 'DOUBLE']);
    expect(consistent(rows)).toBe(true);
    expect(rows.every((r) => typeof r.Customer === 'string' && r.Issued != null && r.Due != null)).toBe(true);
  });
});

describe('Realign rows by hand', () => {
  it('moves the cells of the rows matched to the right by one, and to the left from a row number', async () => {
    const source = src({ id: 'r', format: 'csv' });
    await engine.registerText(sourceFileName(source), 'id,name,city,amount\n1,Ann,Leeds,10\n2,York,20,\n3,Bob,Hull,30\n4,Cardiff,40,\n');
    const base = flow({ sources: [source], nodes: [{ id: 'in', type: 'source', sourceId: source.id }] });
    const withStep = (params: Record<string, unknown>): Project => ({
      ...base,
      nodes: [...base.nodes, { ...base.nodes[0]!, id: 'out', name: 'out', type: 'transform', steps: [step('s', 'realignRows', params)] }],
      edges: [{ id: 'e', from: { nodeId: 'in' }, to: { nodeId: 'out', port: 0 } }],
    });
    const right = withStep({ rows: 'where', from: 1, conditions: [{ column: 'amount', op: 'empty', value: '' }], match: 'all', matchCase: false, columns: ['name', 'city', 'amount'], direction: 'right', by: 1 });
    const rows = tableRows((await engine.query(compile(right, { nodeId: 'out' }).sql)).table);
    expect(rows).toEqual([
      { id: 1, name: 'Ann', city: 'Leeds', amount: '10' },
      { id: 2, name: null, city: 'York', amount: '20' },
      { id: 3, name: 'Bob', city: 'Hull', amount: '30' },
      { id: 4, name: null, city: 'Cardiff', amount: '40' },
    ]);
    const left = withStep({ rows: 'from', from: 3, conditions: [], match: 'all', matchCase: false, columns: ['name', 'city', 'amount'], direction: 'left', by: 1 });
    expect(tableRows((await engine.query(compile(left, { nodeId: 'out' }).sql)).table).slice(2)).toEqual([
      { id: 3, name: 'Hull', city: '30', amount: null },
      { id: 4, name: '40', city: null, amount: null },
    ]);
  });
});
