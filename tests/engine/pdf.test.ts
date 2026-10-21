// PDFs (#193) on real DuckDB-WASM through the rewrite path: the biggest table in the text opens by default, typed by
// DuckDB; the Table option switches to another; a scan is refused with the reason.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEngineStore } from '../../src/app/engine';
import { compile } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createProject, useProjectStore, type Project } from '../../src/model';
import { NO_TEXT } from '../../src/pdf';
import { addFileSource } from '../../src/sources/add';
import { useAttachments } from '../../src/sources/attachments';
import { resetRewrites, syncRewrites, useRewrites } from '../../src/sources/rewrite';
import { addWordTables, tablesNotAdded } from '../../src/sources/word';
import type { WordTableInfo } from '../../src/word';
import { createNodeBackend } from '../helpers/nodeBackend';

const fixture = (name: string) => new File([readFileSync(join(__dirname, '../fixtures/pdf', name)) as Uint8Array<ArrayBuffer>], name);

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
});
afterAll(() => engine.close());
beforeEach(() => {
  resetRewrites();
  useAttachments.setState({ sources: {} });
  useProjectStore.getState().load(createProject('PDF'));
});

const project = () => useProjectStore.getState().history.present;
const nodeOf = (p: Project, sourceId: string) => p.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId)!.id;
const rows = async (sourceId: string) => tableRows((await engine.query(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).table);
const types = async (sourceId: string) => (await engine.describe(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).map((c) => `${c.name} ${c.type}`);
const sync = () => syncRewrites(engine, project());

describe('a PDF', () => {
  it('opens to the biggest table in its text, typed by DuckDB, switches by number and adds the other table as a source', async () => {
    const s = await addFileSource(fixture('statement.pdf'));
    expect(s).toMatchObject({ format: 'pdf', parseOptions: {} });
    await sync();
    expect(useRewrites.getState().reads[s.id]).toMatchObject({ state: 'ok', rows: 4, columns: 4, table: 1 });
    expect(await types(s.id)).toEqual(['Date DATE', 'Description VARCHAR', 'Paid in VARCHAR', 'Paid out VARCHAR']);
    expect((await rows(s.id))[1]).toEqual({ Date: new Date('2026-10-03T00:00:00Z').getTime(), Description: 'Grocer on the corner', 'Paid in': null, 'Paid out': '48.20' });
    const tables = (useRewrites.getState().reads[s.id] as { tables: WordTableInfo[] }).tables;
    expect(tables.map((t) => t.label)).toEqual(['Transactions (page 1)', 'Summary (page 2)']);
    const added = await addWordTables(s, tablesNotAdded(project(), s, tables));
    expect(added.map((a) => [a.name, a.format, a.parseOptions.table])).toEqual([['Summary (page 2)', 'pdf', '2']]);
    await sync();
    expect(await rows(added[0]!.id)).toEqual([
      { Item: 'Opening balance', Amount: '312.40' },
      { Item: 'Closing balance', Amount: '1,634.19' },
    ]);
  });

  it('refuses a scan, saying it has no text', async () => {
    const s = await addFileSource(fixture('scan.pdf'));
    expect(s.format).toBe('pdf');
    await sync();
    expect(useRewrites.getState().reads[s.id]).toMatchObject({ state: 'failed', message: NO_TEXT });
  });
});
