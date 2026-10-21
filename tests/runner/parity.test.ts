// Runner parity for Analyse and fix (#194): each messy fixture is sniffed, analysed and fixed on puddle-run's DuckDB
// with the same pure modules the editor uses, then run as a project. The row counts and types asserted here are the
// ones the engine tests (tests/engine/fixall, shape and samples) get on DuckDB-WASM in the browser's path.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findIssues, planFixes, sortIssues, type Issue } from '../../src/analysis';
import { analyseWith } from '../../src/analysis/analyse';
import { compile } from '../../src/compiler';
import { detectDateFormatsWith } from '../../src/dates';
import { placeFixes, setParseOptions, type Project } from '../../src/model';
import { analyseFile } from '../../src/runner/analyse';
import { openDb, type RunnerDb } from '../../src/runner/db';
import { runProject, stageProject } from '../../src/runner/run';

const fixtures = join(__dirname, '../fixtures');
let db: RunnerDb;
let outDir: string;
beforeAll(async () => {
  db = await openDb();
  outDir = mkdtempSync(join(tmpdir(), 'puddle-parity-'));
});
afterAll(async () => {
  await db.close();
  rmSync(outDir, { recursive: true, force: true });
});

const keys = (issues: Issue[]) => issues.map((i) => i.key);

/**
 * Fix all on the runner: the chosen issues' fixes as read options on the source and steps after the node, then an
 * Output node on the last step, the project run, and the result's rows and columns read back.
 */
async function fixAndRun(path: string, chosen: (issues: Issue[]) => Issue[]) {
  const before = await analyseFile(path, db);
  const { project, nodeId } = before;
  // Planning reads the data again for date formats, so the file is staged again as the editor keeps it registered.
  const planning = await stageProject(project, { folder: dirname(path), db });
  const { steps, readOptions } = await planFixes(chosen(before.issues), {
    available: before.columns,
    locale: project.settings.locale,
    detectDates: (column) => detectDateFormatsWith((sql) => db.query(sql), project, { nodeId }, column),
  }).finally(planning.done);
  let fixed: Project = Object.keys(readOptions).length ? setParseOptions(project, project.sources[0]!.id, { ...project.sources[0]!.parseOptions, ...readOptions }) : project;
  const placed = placeFixes(fixed, nodeId, steps);
  const last = placed ? placed.last.nodeId : nodeId;
  fixed = placed?.project ?? fixed;
  const output = { id: 'out', type: 'output' as const, name: 'out', position: { x: 0, y: 0 }, rules: [], outputSpec: { format: 'csv' as const, options: {} } };
  fixed = { ...fixed, name: `Parity ${before.name}`, nodes: [...fixed.nodes, output], edges: [...fixed.edges, { id: 'e-out', from: { nodeId: last }, to: { nodeId: 'out', port: 0 } }] };
  const { log } = await runProject(fixed, { folder: dirname(path), outDir, db });
  // The output's columns and the issues left, read as the editor reads the last step.
  const staged = await stageProject(fixed, { folder: dirname(path), db });
  try {
    const columns = await db.describe(compile(fixed, { nodeId: last }).sql);
    const analysis = await analyseWith({ rows: (sql) => db.query(sql) }, fixed, last, columns);
    const rows = await db.query(compile(fixed, { nodeId: last }).sql);
    const after = sortIssues(findIssues(columns, analysis.profile, analysis.facts), columns.map((c) => c.name));
    return { before, steps, readOptions, log, rows, types: Object.fromEntries(columns.map((c) => [c.name, c.type])), after };
  } finally {
    staged.done();
  }
}

describe('Fix all on the runner gives the browser’s rows and types', () => {
  it('messy.csv: the seven issues, six steps, four rows with the price as a number', async () => {
    const r = await fixAndRun(join(fixtures, 'messy.csv'), (issues) => issues.filter((i) => i.severity === 'fix'));
    expect(keys(r.before.issues)).toEqual(['duplicateRows', 'nonPrinting:name', 'edgeSpaces:name', 'doubleSpaces:name', 'emptyText:name', 'edgeSpaces:city', 'numbersAsText:price']);
    expect(r.steps.map((s) => s.type)).toEqual(['removeNonPrinting', 'trimWhitespace', 'collapseSpaces', 'emptyToNull', 'parseNumbers', 'duplicateRows']);
    expect(r.log.outputs[0]).toMatchObject({ status: 'written', rows: 4 });
    expect(r.types.price).toBe('DOUBLE');
    expect(r.after.filter((i) => i.severity === 'fix')).toEqual([]);
  });

  it('messy.txt: read with the sniff’s skip options and the words for empty as empty; 40 customers, typed', async () => {
    const r = await fixAndRun(join(fixtures, 'messy', 'messy.txt'), (issues) => issues.filter((i) => i.severity === 'fix'));
    expect(r.before.project.sources[0]!.parseOptions).toMatchObject({ delimiter: ';', skip: 2, skipBottom: 1 });
    expect(r.readOptions).toEqual({ nullStrings: ['-', '?', 'N/A', 'NULL', 'n/a'] });
    expect(r.steps.map((s) => s.type)).toEqual(['removeNonPrinting', 'trimWhitespace', 'collapseSpaces', 'filterRows', 'changeCase', 'parseNumbers', 'parseDates', 'duplicateRows']);
    expect(r.log.outputs[0]).toMatchObject({ status: 'written', rows: 40 });
    expect(r.types).toMatchObject({ Balance: 'DOUBLE', 'Signed up': 'DATE' });
    expect(r.rows[0]).toMatchObject({ 'Customer ID': 'CU1000', 'Customer Name': 'Kofi Jones', City: 'Cardiff', Balance: -4923.54 });
    expect(r.after.filter((i) => i.severity === 'fix')).toEqual([]);
  });

  it('sap-extract.txt: a pipe table in Latin-1; with the total row dropped, 60 line items with German amounts as numbers', async () => {
    const r = await fixAndRun(join(fixtures, 'messy', 'sap-extract.txt'), (issues) => issues.filter((i) => i.severity === 'fix' || i.kind === 'totalRows'));
    expect(r.before.format).toBe('pipes');
    expect(r.before.analysis.facts.rows).toBe(61);
    expect(r.steps.map((s) => s.type)).toEqual(['filterRows', 'parseNumbers']);
    expect(r.log.outputs[0]).toMatchObject({ status: 'written', rows: 60 });
    expect(r.types).toMatchObject({ 'Doc. date': 'DATE', 'Amount in LC': 'DOUBLE' });
    expect(r.rows.map((x) => x['Vendor'])).toContain('Müller GmbH');
    expect(Math.round(r.rows.reduce((sum, x) => sum + Number(x['Amount in LC']), 0) * 100) / 100).toBe(192474.66);
    expect(keys(r.after.filter((i) => i.severity === 'fix'))).toEqual(['numbersAsText:Doc. no.']);
  });

  it('skewed.xlsx: the shifted rows realigned, 36 invoices with dates and amounts typed', async () => {
    const r = await fixAndRun(join(fixtures, 'messy', 'skewed.xlsx'), (issues) => issues.filter((i) => i.severity === 'fix'));
    expect(keys(r.before.issues.filter((i) => i.severity === 'fix'))).toEqual(['skewedRows:Customer:left']);
    expect(r.steps.map((s) => s.type)).toEqual(['realignRows', 'parseNumbers', 'parseDates', 'parseDates']);
    expect(r.log.outputs[0]).toMatchObject({ status: 'written', rows: 36 });
    expect(['Issued', 'Due', 'Net', 'VAT', 'Gross'].map((c) => r.types[c])).toEqual(['DATE', 'DATE', 'DOUBLE', 'DOUBLE', 'DOUBLE']);
    expect(r.rows.every((x) => x.Issued != null && Math.abs(Number(x.Net) + Number(x.VAT) - Number(x.Gross)) < 0.011)).toBe(true);
    expect(r.after.find((i) => i.kind === 'skewedRows')).toBeUndefined();
  });

  it('merged.xlsx: the report table with regions filled; with the totals dropped, 11 stores and no spacer column', async () => {
    const r = await fixAndRun(join(fixtures, 'messy', 'merged.xlsx'), (issues) => issues.filter((i) => i.severity === 'fix' || i.kind === 'totalRows'));
    expect(r.before.columns.map((c) => c.name)).toEqual(['Region', 'Store', 'Q1 Jan', 'Q1 Feb', 'Q1 Mar', 'Q2 Apr', 'Q2 May', 'Q2 Jun', 'Column I', 'Notes']);
    expect(r.before.issues.find((i) => i.kind === 'totalRows')).toMatchObject({ severity: 'suggest', count: 5 });
    expect(r.log.outputs[0]).toMatchObject({ status: 'written', rows: 11 });
    expect(Object.keys(r.types)).not.toContain('Column I');
    expect(r.rows.map((x) => x.Region)).toEqual(['North', 'North', 'North', 'South', 'South', 'South', 'South', 'Scotland', 'Scotland', 'Wales', 'Wales']);
    expect(r.after.find((i) => i.kind === 'totalRows' || i.kind === 'emptyColumn')).toBeUndefined();
  });
});
