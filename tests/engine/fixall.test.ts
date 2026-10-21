// Fix all on real DuckDB-WASM: the steps planned for messy.csv's issues, placed as a Fixes group, leave a node with
// no fix-level issue; unticking one fix leaves just that issue.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyseNode, findIssues, isStepFix, planFixes, sortIssues, type Issue } from '../../src/analysis';
import { foundIssues } from '../../src/analysis/analyse';
import { compile, sourceFileName } from '../../src/compiler';
import { detectDateFormats } from '../../src/dates';
import { EngineClient } from '../../src/engine/client';
import { placeFixes, type Project } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

const messy = src({ id: 'messy', format: 'csv' });
let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  await engine.registerBuffer(sourceFileName(messy), new Uint8Array(readFileSync(join(__dirname, '../fixtures/messy.csv'))));
});
afterAll(() => engine.close());

const analyse = async (project: Project, nodeId: string) => {
  const columns = await engine.describe(`SELECT * FROM (${compile(project, { nodeId }).sql}) LIMIT 0`);
  const analysis = await analyseNode(engine, project, nodeId, columns);
  return { columns, analysis, issues: sortIssues(findIssues(columns, analysis.profile, analysis.facts), columns.map((c) => c.name)) };
};

const fixAll = async (project: Project, chosen: (issues: Issue[]) => Issue[]) => {
  const before = await analyse(project, 'in');
  const { steps } = await planFixes(chosen(before.issues), {
    available: before.columns,
    locale: project.settings.locale,
    detectDates: (column) => detectDateFormats(engine, project, { nodeId: 'in' }, column),
  });
  const placed = placeFixes(project, 'in', steps)!;
  return { before, steps, placed, after: await analyse(placed.project, placed.last.nodeId) };
};

describe('Fix all on messy.csv', () => {
  it('leaves no fix-level issue, in a Fixes group of one node per step, with the rows that remain cleaned', async () => {
    const project = flow({ sources: [messy], nodes: [{ id: 'in', type: 'source', sourceId: messy.id }] });
    const { before, steps, placed, after } = await fixAll(project, (issues) => issues.filter((i) => i.severity === 'fix'));
    expect(before.issues.map((i) => i.key)).toEqual(['duplicateRows', 'nonPrinting:name', 'edgeSpaces:name', 'doubleSpaces:name', 'emptyText:name', 'edgeSpaces:city', 'numbersAsText:price']);
    expect(steps.map((s) => [s.type, s.params.columns])).toEqual([
      ['removeNonPrinting', ['name']],
      ['trimWhitespace', ['name', 'city']],
      ['collapseSpaces', ['name']],
      ['emptyToNull', ['name']],
      ['parseNumbers', ['price']],
      ['duplicateRows', []],
    ]);
    expect(placed.nodeIds).toHaveLength(6);
    expect(placed.project.groups).toEqual([expect.objectContaining({ name: 'Fixes', nodeIds: placed.nodeIds })]);
    expect(after.issues.filter((i) => i.severity === 'fix')).toEqual([]);
    expect(after.analysis.facts.rows).toBe(4);
    // What the project keeps of the analysis for the quality report: each issue in words with its count, no values from the data.
    expect(foundIssues(before.analysis).slice(0, 3)).toEqual([
      { key: 'duplicateRows', kind: 'duplicateRows', label: 'Duplicate rows', count: 1 },
      { key: 'nonPrinting:name', kind: 'nonPrinting', column: 'name', label: 'Non-printing characters in name', count: 2 },
      { key: 'edgeSpaces:name', kind: 'edgeSpaces', column: 'name', label: 'Spaces at either end of name', count: 2 },
    ]);
    expect(after.columns.find((c) => c.name === 'price')?.type).toBe('DOUBLE');
  });

  it('with Trim unticked, fixes the rest and leaves the spaces issues listed', async () => {
    const project = flow({ sources: [messy], nodes: [{ id: 'in', type: 'source', sourceId: messy.id }] });
    const { after } = await fixAll(project, (issues) => issues.filter((i) => i.severity === 'fix' && !(isStepFix(i.fix) && i.fix.type === 'trimWhitespace')));
    expect(after.issues.map((i) => i.key).sort()).toEqual(['edgeSpaces:city', 'edgeSpaces:name']);
  });
});
