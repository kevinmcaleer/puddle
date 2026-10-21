// Fixed-width text and pipe tables end to end below the UI: Puddle's readers (src/sources/fixedWidth, pipes), the
// CSV they hand over, and real DuckDB-WASM (Node build) typing and reading it through the compiler; the boundaries
// found, moved and the columns changing; Fix all typing the balances.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyseNode, findIssues, planFixes, sortIssues } from '../../src/analysis';
import { useEngineStore } from '../../src/app/engine';
import { compile, sourceFileName } from '../../src/compiler';
import { detectDateFormats } from '../../src/dates';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createProject, placeFixes, setParseOptions, useProjectStore, type Project, type Source } from '../../src/model';
import { addClipboardSource, addFileSource } from '../../src/sources/add';
import { useAttachments } from '../../src/sources/attachments';
import { withBoundary } from '../../src/sources/fixedWidth';
import { resetRewrites, rewriteReady, syncRewrites, useRewrites } from '../../src/sources/rewrite';
import { createNodeBackend } from '../helpers/nodeBackend';

const messy = join(__dirname, '../fixtures/messy');
const FIXED = readFileSync(join(messy, 'fixed-width.txt'));
const SAP = readFileSync(join(messy, 'sap-extract.txt'));

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
});
afterAll(() => engine.close());
beforeEach(() => {
  resetRewrites();
  useAttachments.setState({ sources: {} });
  useProjectStore.getState().load(createProject('Readers'));
});

const project = () => useProjectStore.getState().history.present;
const nodeOf = (p: Project, sourceId: string) => p.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId)!.id;
const sync = () => syncRewrites(engine, project());
const target = (sourceId: string) => compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql;
const rows = async (sourceId: string) => tableRows((await engine.query(target(sourceId))).table);
const columns = async (sourceId: string) => (await engine.describe(target(sourceId))).map((c) => `${c.name} ${c.type}`);
const setOptions = (id: string, f: (s: Source) => Source['parseOptions']) => useProjectStore.getState().apply((p) => setParseOptions(p, id, f(p.sources.find((s) => s.id === id)!)));

describe('fixed-width text', () => {
  it('adds the file with its boundaries found, and reads it into named columns', async () => {
    const s = await addFileSource(new File([FIXED], 'fixed-width.txt'));
    expect(s).toMatchObject({ kind: 'file', format: 'fixed', parseOptions: { boundaries: [8, 30, 43, 54, 64] } });
    expect(rewriteReady(project(), s.id)).toBe(false);
    await sync();
    expect(rewriteReady(project(), s.id)).toBe(true);
    expect(useRewrites.getState().reads[s.id]).toMatchObject({ state: 'ok', rows: 30, columns: 6, boundaries: [8, 30, 43, 54, 64] });
    expect((useRewrites.getState().reads[s.id] as { lines: string[] }).lines).toHaveLength(12);
    // The balances keep their thousands separators and trailing minus as text; the dates are eight digits, so numbers to DuckDB.
    expect(await columns(s.id)).toEqual(['CUSTNO BIGINT', 'NAME VARCHAR', 'CITY VARCHAR', 'BALANCE VARCHAR', 'SINCE BIGINT', 'ST VARCHAR']);
    const r = await rows(s.id);
    expect(r).toHaveLength(30);
    expect(r[0]).toEqual({ CUSTNO: 100200, NAME: 'Kofi Patel', CITY: 'Leeds', BALANCE: '15,369.45', SINCE: 20240914, ST: 'A' });
    expect(r[1]).toMatchObject({ BALANCE: '2,933.84-' });
    expect(r.some((x) => x.BALANCE === null)).toBe(true);
  });

  it('moving or removing a boundary changes the columns, and undo brings the earlier read back without reading again', async () => {
    const s = await addFileSource(new File([FIXED], 'fixed-width.txt'));
    await sync();
    const first = sourceFileName(project().sources[0]!);

    // The boundary between NAME and CITY removed: one column of both.
    setOptions(s.id, (x) => ({ ...x.parseOptions, boundaries: withBoundary(x.parseOptions.boundaries!, 30) }));
    expect(project().sources[0]!.parseOptions.boundaries).toEqual([8, 43, 54, 64]);
    expect(rewriteReady(project(), s.id)).toBe(false);
    await sync();
    // The header line is cut the same way, so the merged column carries both names.
    expect((await columns(s.id)).map((c) => c.replace(/ \w+$/, ''))).toEqual(['CUSTNO', 'NAME                  CITY', 'BALANCE', 'SINCE', 'ST']);
    expect(Object.values((await rows(s.id))[0]!)).toEqual([100200, 'Kofi Patel            Leeds', '15,369.45', 20240914, 'A']);

    // Moved: the first boundary two characters right takes the first two letters of each name into the number column.
    setOptions(s.id, (x) => ({ ...x.parseOptions, boundaries: withBoundary(x.parseOptions.boundaries!, 8, 10) }));
    await sync();
    expect(Object.values((await rows(s.id))[0]!).slice(0, 2)).toEqual(['100200  Ko', 'fi Patel            Leeds']);

    useProjectStore.getState().undo();
    useProjectStore.getState().undo();
    expect(sourceFileName(project().sources[0]!)).toBe(first);
    await sync();
    expect(rewriteReady(project(), s.id)).toBe(true);
    expect((await columns(s.id)).length).toBe(6);
  });

  it('Fix all types the balances, trailing minus and all', async () => {
    const s = await addFileSource(new File([FIXED], 'fixed-width.txt'));
    await sync();
    const nodeId = nodeOf(project(), s.id);
    const described = await engine.describe(target(s.id));
    const analysis = await analyseNode(engine, project(), nodeId, described);
    const issues = sortIssues(findIssues(described, analysis.profile, analysis.facts), described.map((c) => c.name));
    expect(issues.map((i) => i.key)).toContain('numbersAsText:BALANCE');
    const { steps } = await planFixes(issues.filter((i) => i.severity === 'fix'), { available: described, locale: project().settings.locale, detectDates: (column) => detectDateFormats(engine, project(), { nodeId }, column) });
    const placed = placeFixes(project(), nodeId, steps)!;
    const r = tableRows((await engine.query(compile(placed.project, { nodeId: placed.last.nodeId }).sql)).table);
    expect(r).toHaveLength(30);
    expect(r[0]).toMatchObject({ BALANCE: 15369.45 });
    expect(r[1]).toMatchObject({ BALANCE: -2933.84 });
  });
});

describe('pipe tables', () => {
  it('reads the SAP extract as eight named columns with the lines around the table left out', async () => {
    const s = await addFileSource(new File([SAP], 'sap-extract.txt'));
    expect(s).toMatchObject({ format: 'pipes', parseOptions: { encoding: 'latin-1' } });
    await sync();
    // The banners, rules, the page break, the header printed again and the footer: 15 lines dropped.
    expect(useRewrites.getState().reads[s.id]).toMatchObject({ state: 'ok', rows: 61, columns: 8, dropped: 15 });
    expect(await columns(s.id)).toEqual(['Doc. no. VARCHAR', 'Vendor VARCHAR', 'Doc. date DATE', 'Pstng date DATE', 'Crcy VARCHAR', 'Amount in LC VARCHAR', 'Cost ctr VARCHAR', 'Text VARCHAR']);
    const r = await rows(s.id);
    expect(r).toHaveLength(61);
    expect(r.map((x) => x['Vendor'])).toContain('Müller GmbH');
    expect(r[60]).toMatchObject({ 'Doc. no.': '*', 'Amount in LC': '192.474,66' });
  });

  it('reads a pasted Markdown table, the alignment row dropped', async () => {
    const s = await addClipboardSource('| name | qty |\n|:-----|----:|\n| Ada  | 1 |\n| Bob  | 22 |\n');
    expect(s.format).toBe('pipes');
    await sync();
    expect(await rows(s.id)).toEqual([
      { name: 'Ada', qty: 1 },
      { name: 'Bob', qty: 22 },
    ]);
  });
});
