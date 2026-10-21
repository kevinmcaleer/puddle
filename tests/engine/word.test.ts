// Word documents (#193) on real DuckDB-WASM through the rewrite path: the biggest table opens by default, typed by
// DuckDB; the Table option switches to another; the other tables can be added as sources sharing the file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEngineStore } from '../../src/app/engine';
import { compile } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createProject, setParseOptions, useProjectStore, type Project } from '../../src/model';
import { addFileSource } from '../../src/sources/add';
import { useAttachments } from '../../src/sources/attachments';
import { resetRewrites, rewriteReady, syncRewrites, useRewrites } from '../../src/sources/rewrite';
import { addWordTables, tablesNotAdded } from '../../src/sources/word';
import { createNodeBackend } from '../helpers/nodeBackend';

const fixture = (name: string) => new File([readFileSync(join(__dirname, '../fixtures/word', name)) as Uint8Array<ArrayBuffer>], name);

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
});
afterAll(() => engine.close());
beforeEach(() => {
  resetRewrites();
  useAttachments.setState({ sources: {} });
  useProjectStore.getState().load(createProject('Word'));
});

const project = () => useProjectStore.getState().history.present;
const nodeOf = (p: Project, sourceId: string) => p.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId)!.id;
const rows = async (sourceId: string) => tableRows((await engine.query(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).table);
const types = async (sourceId: string) => (await engine.describe(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).map((c) => `${c.name} ${c.type}`);
const sync = () => syncRewrites(engine, project());

describe('a Word document', () => {
  it('opens to its biggest table, typed by DuckDB, and switches to another by its number', async () => {
    const s = await addFileSource(fixture('report.docx'));
    expect(s).toMatchObject({ format: 'word', parseOptions: {} });
    expect(rewriteReady(project(), s.id)).toBe(false);
    await sync();
    expect(useRewrites.getState().reads[s.id]).toMatchObject({ state: 'ok', rows: 3, columns: 4, table: 3 });
    expect((useRewrites.getState().reads[s.id] as { tables: { label: string }[] }).tables.map((t) => t.label)).toEqual(['Sales by region', 'Figures are in thousands.', 'Table 2: Staff at the end of June']);
    expect(await types(s.id)).toEqual(['Name VARCHAR', 'Role & team VARCHAR', 'Role & team 2 VARCHAR', 'Started DATE']);
    useProjectStore.getState().apply((p) => setParseOptions(p, s.id, { table: '1' }));
    await sync();
    expect(await types(s.id)).toEqual(['Region VARCHAR', 'Quarter VARCHAR', 'Amount DOUBLE']);
    expect(await rows(s.id)).toEqual([
      { Region: 'North', Quarter: 'Q1', Amount: 120 },
      { Region: 'North', Quarter: 'Q2', Amount: 130.5 },
      { Region: 'South', Quarter: 'Q1', Amount: 80 },
      { Region: 'South', Quarter: 'Q2', Amount: null },
    ]);
    useProjectStore.getState().apply((p) => setParseOptions(p, s.id, { table: '1', header: false }));
    await sync();
    expect((await rows(s.id))[0]).toEqual({ 'Column 1': 'Region', 'Column 2': 'Quarter', 'Column 3': 'Amount' });
  });

  it('adds the other tables as sources sharing the file, and says when a table isn’t there', async () => {
    const s = await addFileSource(fixture('report.docx'));
    await sync();
    const tables = (useRewrites.getState().reads[s.id] as { tables: { index: number; label: string }[] }).tables;
    expect(tablesNotAdded(project(), s, tables).map((t) => t.index)).toEqual([1, 2]);
    const added = await addWordTables(s, tablesNotAdded(project(), s, tables));
    expect(added.map((a) => [a.name, a.parseOptions.table])).toEqual([
      ['Sales by region', '1'],
      ['Figures are in thousands.', '2'],
    ]);
    expect(tablesNotAdded(project(), s, tables)).toEqual([]);
    await sync();
    expect(await rows(added[1]!.id)).toEqual([]);
    expect(await types(added[1]!.id)).toEqual(['Note: the South Q2 figure was not available when this report was written. VARCHAR']);
    useProjectStore.getState().apply((p) => setParseOptions(p, s.id, { table: '9' }));
    await sync();
    expect(useRewrites.getState().reads[s.id]).toMatchObject({ state: 'failed', message: 'There is no table 9 in this document: it has 3 tables.' });
  });
});
