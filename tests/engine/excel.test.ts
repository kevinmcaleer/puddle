// Excel sources end to end below the UI: SheetJS (the worker's service, run in process), the Arrow table it makes,
// and real DuckDB-WASM (Node build) reading it through the compiler.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { useEngineStore } from '../../src/app/engine';
import { compile, compileCount, sourceTableName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { inProcessClient, setExcelClient, type ExcelClient } from '../../src/excel/client';
import { ExcelService } from '../../src/excel/service';
import { evaluateFlow, useFlowStore } from '../../src/flow/status';
import { createProject, removeNodes, setParseOptions, useProjectStore, type Project, type Source } from '../../src/model';
import { addFileSource } from '../../src/sources/add';
import { attachProject, reattachFile } from '../../src/sources/attach';
import { useAttachments } from '../../src/sources/attachments';
import { excelReady, resetExcelSources, syncExcelSources, useExcelReads, withSheet } from '../../src/sources/excel';
import { createNodeBackend } from '../helpers/nodeBackend';

const bytes = readFileSync(join(__dirname, '../fixtures/sales.xlsx'));
const workbook = (name = 'sales.xlsx', data: BlobPart = bytes) => new File([data], name);

let engine: EngineClient;
let client: ExcelClient & { reads: number };

beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
});
afterAll(() => engine.close());
beforeEach(() => {
  const inner = inProcessClient(new ExcelService());
  client = {
    reads: 0,
    call(op, args) {
      if (op === 'read') client.reads++;
      return inner.call(op, args);
    },
  };
  setExcelClient(client);
  resetExcelSources();
  useAttachments.setState({ sources: {} });
  useProjectStore.getState().load(createProject('Excel'));
});
afterEach(() => setExcelClient(undefined));

const project = () => useProjectStore.getState().history.present;
const sourceOf = (id: string) => project().sources.find((s) => s.id === id)!;
const nodeOf = (p: Project, sourceId: string) => p.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId)!.id;
const sync = () => syncExcelSources(engine, project(), client);
const rows = async (sourceId: string) => tableRows((await engine.query(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).table);
const types = async (sourceId: string) => (await engine.describe(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).map((c) => `${c.name} ${c.type}`);
const tables = async () => tableRows((await engine.query(`SELECT table_name AS t FROM duckdb_tables() ORDER BY t`)).table).map((r) => String(r.t));
const setOptions = (id: string, f: (s: Source) => Source['parseOptions']) => useProjectStore.getState().apply((p) => setParseOptions(p, id, f(p.sources.find((s) => s.id === id)!)));

describe('Excel sources', () => {
  it('adds a workbook and reads its first sheet into DuckDB with Excel types', async () => {
    const s = await addFileSource(workbook());
    expect(s).toMatchObject({ kind: 'file', format: 'xlsx', name: 'sales.xlsx', parseOptions: {} });
    expect(excelReady(project(), s.id)).toBe(false);
    await sync();
    expect(excelReady(project(), s.id)).toBe(true);
    expect(useExcelReads.getState().reads[s.id]).toMatchObject({
      state: 'ok',
      sheet: 'Sales',
      headerRow: 3,
      range: 'A3:H7',
      rows: 4,
      sheets: [
        { name: 'Sales', rows: 7, columns: 8 },
        { name: 'Visits', rows: 3, columns: 4 },
        { name: 'Empty', rows: 0, columns: 0 },
      ],
    });
    expect(await types(s.id)).toEqual([
      'Region VARCHAR',
      'Order date DATE',
      'Amount DOUBLE',
      'Paid BOOLEAN',
      'Notes VARCHAR',
      'Contact VARCHAR',
      'Contact_2 VARCHAR',
      'Column H BIGINT',
    ]);
    const [first, , , last] = await rows(s.id);
    expect(first).toMatchObject({ Region: 'North', 'Order date': Date.UTC(2026, 0, 5), Amount: 120.5, Paid: true, Contact: 'Ann', Contact_2: 'ann@example.com', 'Column H': 1 });
    expect(last).toMatchObject({ Region: 'West', Amount: null, Notes: 'Awaiting stock' });
    // Steps run on the sheet like on any other source.
    const p = project();
    const [{ n }] = tableRows((await engine.query(compileCount(p, { nodeId: nodeOf(p, s.id) }))).table) as [{ n: number }];
    expect(n).toBe(4);
  });

  it('switches sheet in one undo step, and switches back without reading again', async () => {
    const s = await addFileSource(workbook());
    await sync();
    const past = useProjectStore.getState().history.past.length;
    setOptions(s.id, (x) => withSheet(x.parseOptions, 'Visits'));
    expect(useProjectStore.getState().history.past.length).toBe(past + 1);
    expect(excelReady(project(), s.id)).toBe(false);
    await sync();
    expect(await types(s.id)).toEqual(['Visitor VARCHAR', 'Arrived TIMESTAMP', 'Count BIGINT', 'Mixed VARCHAR']);
    expect((await rows(s.id))[0]).toMatchObject({ Visitor: 'Ann', Arrived: Date.UTC(2026, 0, 5, 9, 30), Count: 3, Mixed: '1' });
    expect(client.reads).toBe(2);

    useProjectStore.getState().undo();
    expect(sourceOf(s.id).parseOptions).toEqual({});
    // The first sheet's table is still loaded, so it is ready at once.
    expect(excelReady(project(), s.id)).toBe(true);
    await sync();
    expect(client.reads).toBe(2);
    expect(useExcelReads.getState().reads[s.id]).toMatchObject({ state: 'ok', sheet: 'Sales' });
    expect((await rows(s.id))[0]).toMatchObject({ Region: 'North' });
  });

  it('reads again with a header row and range, and says plainly when the options don’t fit', async () => {
    const s = await addFileSource(workbook());
    await sync();
    setOptions(s.id, (x) => ({ ...x.parseOptions, headerRow: 3, range: 'A3:C5' }));
    await sync();
    expect(await types(s.id)).toEqual(['Region VARCHAR', 'Order date DATE', 'Amount DOUBLE']);
    expect(await rows(s.id)).toHaveLength(2);

    setOptions(s.id, (x) => ({ ...x.parseOptions, headerRow: 9 }));
    await sync();
    expect(excelReady(project(), s.id)).toBe(false);
    expect(useExcelReads.getState().reads[s.id]).toMatchObject({ state: 'failed', message: 'Row 9 is outside the data read (A3:C5). Choose a header row from 3 to 5.' });
    // The sheets stay listed, so another can be chosen.
    expect(useExcelReads.getState().reads[s.id]).toMatchObject({ sheets: expect.arrayContaining([expect.objectContaining({ name: 'Visits' })]) });
    // A failed read isn't retried until something changes.
    const reads = client.reads;
    await sync();
    expect(client.reads).toBe(reads);
  });

  it('marks the source node unreadable until its sheet is loaded, then runs it', async () => {
    const s = await addFileSource(workbook());
    const id = nodeOf(project(), s.id);
    const readable = (sourceId: string) => excelReady(project(), sourceId);
    await evaluateFlow(engine, project(), (x) => !readable(x));
    expect(useFlowStore.getState().nodes[id]?.status.state).toBe('detached');
    await sync();
    await evaluateFlow(engine, project(), (x) => !readable(x));
    expect(useFlowStore.getState().nodes[id]?.status).toMatchObject({ state: 'ok', columns: expect.arrayContaining([{ name: 'Order date', type: 'DATE' }]) });
  });

  it('keeps a couple of tables per source and drops a removed source’s tables', async () => {
    const s = await addFileSource(workbook());
    const mine = async () => (await tables()).filter((t) => t.startsWith(`src_${s.id}_`));
    await sync();
    for (const sheet of ['Visits', 'Sales', 'Visits']) {
      setOptions(s.id, (x) => ({ ...withSheet(x.parseOptions, sheet), headerRow: 1 }));
      await sync();
    }
    expect(await mine()).toHaveLength(2);
    expect(await mine()).toContain(sourceTableName(sourceOf(s.id)));
    useProjectStore.getState().apply((p) => removeNodes(p, [nodeOf(p, s.id)]));
    await sync();
    await new Promise((r) => setTimeout(r, 10));
    expect(await mine()).toEqual([]);
    expect(useExcelReads.getState().reads[s.id]).toBeUndefined();
  });

  it('reads a reopened project’s workbook once it is chosen again, and warns when it differs', async () => {
    const s = await addFileSource(workbook());
    await sync();
    const saved = project();
    resetExcelSources();
    // Reopen in a fresh tab: the file isn't known, so the source is detached and nothing is read.
    useProjectStore.getState().load({ ...saved, id: 'reopened', sources: saved.sources.map((x) => ({ ...x, id: 'r1' })), nodes: saved.nodes.map((n) => (n.type === 'source' ? { ...n, sourceId: 'r1' } : n)) });
    await attachProject(project());
    await sync();
    expect(useAttachments.getState().sources.r1).toBe('detached');
    expect(client.reads).toBe(1);

    expect(await reattachFile(sourceOf('r1'), workbook('sales.xlsx'))).toBe('attached');
    await sync();
    expect(excelReady(project(), 'r1')).toBe(true);
    expect((await rows('r1'))[0]).toMatchObject({ Region: 'North' });

    // Another workbook entirely: attached, marked as different, and read afresh.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Region'], ['Only']]), 'Sales');
    const other = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    expect(await reattachFile(sourceOf('r1'), workbook('sales.xlsx', other))).toBe('mismatch');
    await sync();
    expect(await rows('r1')).toEqual([{ Region: 'Only' }]);
    expect(s.id).not.toBe('r1');
  });

  it('shows a workbook that can’t be read as a read failure in plain words', async () => {
    // A zip whose first entry is under xl/ but holds nothing: the sniff calls it a workbook, SheetJS can't read it.
    // (A CSV named .xlsx no longer gets here: its content wins, and it opens as CSV.)
    const entry = 'xl/workbook.xml';
    const s = await addFileSource(workbook('book.xlsx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, entry.length, 0, 0, 0, ...new TextEncoder().encode(entry)])));
    await sync();
    expect(useExcelReads.getState().reads[s.id]).toMatchObject({ state: 'failed', message: expect.stringMatching(/^This workbook can’t be read \(.+\)\. Open it in Excel, save it again as \.xlsx, and add it again\.$/) });
  });
});
