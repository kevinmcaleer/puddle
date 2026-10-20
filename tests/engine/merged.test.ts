// merged.xlsx on real DuckDB-WASM, through the Excel worker's service: the report opens as one table with its two
// header rows joined and the regions filled down, its totals and spacer column are issues that Fix all clears, the
// merged cells are an issue only when left unfilled, and the footnotes are offered as a table of their own.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyseNode, findIssues, planFixes, sortIssues, type Issue } from '../../src/analysis';
import { useEngineStore } from '../../src/app/engine';
import { compile } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { inProcessClient, setExcelClient } from '../../src/excel/client';
import { ExcelService } from '../../src/excel/service';
import { createProject, placeFixes, setParseOptions, useProjectStore, type Project } from '../../src/model';
import { addFileSource } from '../../src/sources/add';
import { useAttachments } from '../../src/sources/attachments';
import { addExcelTables, resetExcelSources, sheetTablesNotAdded, syncExcelSources, useExcelReads } from '../../src/sources/excel';
import { createNodeBackend } from '../helpers/nodeBackend';

const bytes = readFileSync(join(__dirname, '../fixtures/messy/merged.xlsx'));
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
  useProjectStore.getState().load(createProject('Merged'));
});
afterEach(() => setExcelClient(undefined));

const project = () => useProjectStore.getState().history.present;
const nodeOf = (sourceId: string) => project().nodes.find((n) => n.type === 'source' && n.sourceId === sourceId)!.id;
const sync = () => syncExcelSources(engine, project());

const analyse = async (p: Project, nodeId: string) => {
  const columns = await engine.describe(`SELECT * FROM (${compile(p, { nodeId }).sql}) LIMIT 0`);
  const analysis = await analyseNode(engine, p, nodeId, columns);
  return { columns, analysis, issues: sortIssues(findIssues(columns, analysis.profile, analysis.facts), columns.map((c) => c.name)) };
};
const keys = (issues: Issue[]) => issues.map((i) => i.key);

async function open() {
  const source = await addFileSource(new File([bytes], 'merged.xlsx'));
  await sync();
  return { source, nodeId: nodeOf(source.id) };
}

describe('merged.xlsx', () => {
  it('opens as the report table, two header rows joined, regions filled down, 16 rows', async () => {
    const { source, nodeId } = await open();
    expect(useExcelReads.getState().reads[source.id]).toMatchObject({ state: 'ok', range: 'A4:J21', headerRow: 4, headerRows: 2, merges: 4, rows: 16, tables: [{ range: 'A4:J21' }, { range: 'A24:B28' }] });
    const rows = tableRows((await engine.query(compile(project(), { nodeId }).sql)).table);
    expect(Object.keys(rows[0]!)).toEqual(['Region', 'Store', 'Q1 Jan', 'Q1 Feb', 'Q1 Mar', 'Q2 Apr', 'Q2 May', 'Q2 Jun', 'Column I', 'Notes']);
    expect(rows.map((r) => r['Region'])).toEqual(['North', 'North', 'North', null, 'South', 'South', 'South', 'South', null, 'Scotland', 'Scotland', null, 'Wales', 'Wales', null, null]);
    expect(rows[1]).toMatchObject({ Store: 'Manchester', 'Q1 Jan': 692, Notes: 'Includes online orders' });
  });

  it('lists the five total rows and the spacer column as issues; the totals ticked, Fix all leaves the 11 stores', async () => {
    const { nodeId } = await open();
    const before = await analyse(project(), nodeId);
    expect(keys(before.issues)).toContain('totalRows');
    expect(keys(before.issues)).toContain('emptyColumn:Column I');
    expect(keys(before.issues)).not.toContain('mergedCells');
    const total = before.issues.find((i) => i.key === 'totalRows')!;
    expect(total).toMatchObject({ count: 5, severity: 'suggest', examples: ['north total', 'south total', 'scotland total', 'wales total', 'grand total'] });
    expect(total.fix).toMatchObject({ type: 'filterRows', params: { mode: 'remove', match: 'any', conditions: expect.arrayContaining([{ column: 'Store', op: 'startsWith', value: 'grand total' }]) } });
    const chosen = before.issues.filter((i) => i.severity === 'fix' || i.kind === 'totalRows');
    const { steps, readOptions } = await planFixes(chosen, { available: before.columns, locale: project().settings.locale });
    expect(readOptions).toEqual({});
    expect(steps.map((s) => s.type)).toEqual(['filterRows', 'removeColumns']);
    const placed = placeFixes(project(), nodeId, steps)!;
    const rows = tableRows((await engine.query(compile(placed.project, { nodeId: placed.last.nodeId }).sql)).table);
    expect(rows).toHaveLength(11);
    expect(Object.keys(rows[0]!)).not.toContain('Column I');
    expect(rows.every((r) => r['Region'] != null)).toBe(true);
    const after = await analyse(placed.project, placed.last.nodeId);
    expect(keys(after.issues)).not.toContain('totalRows');
  });

  it('with Fill merged cells off, the regions are empty below each merged cell and the merges are an issue whose fix turns it on', async () => {
    const { source, nodeId } = await open();
    useProjectStore.getState().apply((p) => setParseOptions(p, source.id, { fillMerges: false }));
    await sync();
    const rows = tableRows((await engine.query(compile(project(), { nodeId }).sql)).table);
    expect(rows.slice(0, 4).map((r) => r['Region'])).toEqual(['North', null, null, null]);
    const { issues, columns } = await analyse(project(), nodeId);
    const merged = issues.find((i) => i.key === 'mergedCells')!;
    expect(merged).toMatchObject({ count: 4, severity: 'fix', fix: { readOptions: { fillMerges: true }, label: 'Fill merged cells' } });
    const { readOptions } = await planFixes([merged], { available: columns, locale: project().settings.locale });
    expect(readOptions).toEqual({ fillMerges: true });
  });

  it('offers the footnotes as a table to add, which reads with its own header', async () => {
    const { source } = await open();
    const reads = useExcelReads.getState().reads;
    const others = sheetTablesNotAdded(project(), source, reads[source.id], reads);
    expect(others).toEqual([{ range: 'A24:B28', rows: 5, columns: 2, cells: 9 }]);
    const [added] = addExcelTables(source, others);
    expect(added).toMatchObject({ name: 'merged.xlsx A24:B28', format: 'xlsx', parseOptions: { sheet: 'H1 2026', range: 'A24:B28' } });
    await sync();
    const rows = tableRows((await engine.query(compile(project(), { nodeId: nodeOf(added!.id) }).sql)).table);
    expect(rows).toEqual([
      { Code: 'Q1', Meaning: 'January to March' },
      { Code: 'Q2', Meaning: 'April to June' },
      { Code: 'GBP thousands', Meaning: 'Rounded to the nearest thousand' },
    ]);
    const now = useExcelReads.getState().reads;
    expect(sheetTablesNotAdded(project(), source, now[source.id], now)).toEqual([]);
    expect(sheetTablesNotAdded(project(), added!, now[added!.id], now)).toEqual([]);
  });
});
