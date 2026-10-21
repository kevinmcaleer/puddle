// Compressed files, zip archives and Arrow IPC files (#192) on real DuckDB-WASM: a .csv.gz handed to DuckDB as it is,
// a zip opened for the file inside with its other files added as sources, a gzipped workbook unpacked for SheetJS,
// and an Arrow file loaded as a typed table.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEngineStore } from '../../src/app/engine';
import { compile, readsCompressed, sourceFileName, sourceTableName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { inProcessClient, setExcelClient } from '../../src/excel/client';
import { ExcelService } from '../../src/excel/service';
import { createProject, useProjectStore, type Project } from '../../src/model';
import { addFileSource, changeSourceFormat, sourceFile } from '../../src/sources/add';
import { addArchiveEntries, changeArchiveEntry, entriesNotAdded, resetArchives, sourceArchive, useArchives } from '../../src/sources/archive';
import { arrowReady, resetArrowSources, syncArrowSources, useArrowReads } from '../../src/sources/arrow';
import { reattachFile } from '../../src/sources/attach';
import { useAttachments } from '../../src/sources/attachments';
import { resetExcelSources, syncExcelSources, useExcelReads } from '../../src/sources/excel';
import { resetRewrites, syncRewrites } from '../../src/sources/rewrite';
import { createNodeBackend } from '../helpers/nodeBackend';

const fixture = (name: string) => new File([readFileSync(join(__dirname, '../fixtures/archives', name)) as Uint8Array<ArrayBuffer>], name);
const ORDERS = [
  { order_id: 100, customer_id: 1, total: 12.5, status: 'shipped' },
  { order_id: 101, customer_id: 2, total: 8, status: 'pending' },
];

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
});
afterAll(() => engine.close());
beforeEach(() => {
  setExcelClient(inProcessClient(new ExcelService()));
  resetExcelSources();
  resetArrowSources();
  resetArchives();
  resetRewrites();
  useAttachments.setState({ sources: {} });
  useProjectStore.getState().load(createProject('Archives'));
});
afterEach(() => setExcelClient(undefined));

const project = () => useProjectStore.getState().history.present;
const sourceOf = (id: string) => project().sources.find((s) => s.id === id)!;
const nodeOf = (p: Project, sourceId: string) => p.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId)!.id;
const rows = async (sourceId: string) => tableRows((await engine.query(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).table);
const types = async (sourceId: string) => (await engine.describe(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).map((c) => `${c.name} ${c.type}`);
const entries = async (id: string) => {
  for (let i = 0; i < 50 && !useArchives.getState().entries[id]; i++) await new Promise((r) => setTimeout(r, 20));
  return useArchives.getState().entries[id]!.map((e) => e.name);
};

describe('a gzipped CSV', () => {
  it('is read by DuckDB as it is, named for the file inside, unpacked as it reads', async () => {
    const s = await addFileSource(fixture('orders.csv.gz'));
    expect(s).toMatchObject({ name: 'orders.csv', format: 'csv', archive: { kind: 'gzip', entry: 'orders.csv' }, file: { originalName: 'orders.csv.gz' }, parseOptions: {} });
    expect(readsCompressed(s)).toBe(true);
    expect(sourceFileName(s)).toMatch(/\.csv\.gz$/);
    // The reader's file is the archive itself; nothing was unpacked.
    expect(sourceFile(s.id)).toBe(sourceArchive(s.id));
    expect((await rows(s.id)).slice(0, 2)).toEqual(ORDERS);
    expect(await entries(s.id)).toEqual(['orders.csv']);
  });

  it('is unpacked once the format is one DuckDB can’t stream, and streamed again when it is CSV again', async () => {
    const s = await addFileSource(fixture('orders.csv.gz'));
    await changeSourceFormat(s.id, 'pipes', {});
    expect(sourceFile(s.id)).not.toBe(sourceArchive(s.id));
    expect(sourceFile(s.id)!.name).toBe('orders.csv');
    await syncRewrites(engine, project());
    await changeSourceFormat(s.id, 'csv', {});
    expect(sourceFile(s.id)).toBe(sourceArchive(s.id));
    expect((await rows(s.id)).length).toBe(5);
  });
});

describe('a zip archive', () => {
  it('opens to its first data file, lists the rest, and adds them as sources sharing the archive', async () => {
    const s = await addFileSource(fixture('shop.zip'));
    expect(s).toMatchObject({ name: 'orders.csv', format: 'csv', archive: { kind: 'zip', entry: 'shop/orders.csv' }, file: { originalName: 'shop.zip' } });
    expect(sourceFileName(s)).toMatch(/\.csv$/);
    expect((await rows(s.id)).slice(0, 2)).toEqual(ORDERS);
    expect(await entries(s.id)).toEqual(['shop/orders.csv', 'shop/customers.csv', '__MACOSX/shop/._orders.csv', 'shop/.DS_Store']);
    // The junk a Mac zip carries is never offered.
    expect(entriesNotAdded(project(), s, useArchives.getState().entries[s.id]!).map((e) => e.name)).toEqual(['shop/customers.csv']);
    const [c] = await addArchiveEntries(s, ['shop/customers.csv']);
    expect(c).toMatchObject({ name: 'customers.csv', format: 'csv', archive: { kind: 'zip', entry: 'shop/customers.csv' } });
    expect(sourceArchive(c!.id)).toBe(sourceArchive(s.id));
    expect(sourceFileName(c!)).not.toBe(sourceFileName(s));
    expect((await rows(c!.id))[0]).toEqual({ customer_id: 1, name: 'Ada', status: 'active' });
    expect(entriesNotAdded(project(), s, useArchives.getState().entries[s.id]!)).toEqual([]);
    // One undo step for the lot, below the archive's node.
    const p = project();
    expect(p.nodes.find((n) => n.type === 'source' && n.sourceId === c!.id)!.position.y).toBeGreaterThan(p.nodes.find((n) => n.type === 'source' && n.sourceId === s.id)!.position.y);
  });

  it('switches to another file inside, renamed for it, and reads it as what it is', async () => {
    const s = await addFileSource(fixture('shop.zip'));
    await changeArchiveEntry(s.id, 'shop/customers.csv');
    expect(sourceOf(s.id)).toMatchObject({ name: 'customers.csv', archive: { kind: 'zip', entry: 'shop/customers.csv' } });
    expect(project().nodes.find((n) => n.type === 'source' && n.sourceId === s.id)!.name).toBe('customers.csv');
    expect((await rows(s.id)).length).toBe(5);
    expect(await types(s.id)).toEqual(['customer_id BIGINT', 'name VARCHAR', 'status VARCHAR']);
  });

  it('with one file opens straight to it, and reconnects when the archive is chosen again', async () => {
    const s = await addFileSource(fixture('orders.zip'));
    expect(s).toMatchObject({ name: 'orders.csv', archive: { kind: 'zip', entry: 'orders.csv' } });
    expect((await rows(s.id)).length).toBe(5);
    // Opened again: the archive is chosen, not the file inside.
    resetArchives();
    useAttachments.setState({ sources: {} });
    expect(await reattachFile(sourceOf(s.id), fixture('orders.zip'))).toBe('attached');
    expect(sourceArchive(s.id)?.name).toBe('orders.zip');
    expect((await rows(s.id)).length).toBe(5);
  });
});

describe('a gzipped workbook', () => {
  it('is unpacked and read by SheetJS like the workbook itself', async () => {
    const s = await addFileSource(fixture('sales.xlsx.gz'));
    expect(s).toMatchObject({ name: 'sales.xlsx', format: 'xlsx', archive: { kind: 'gzip', entry: 'sales.xlsx' } });
    expect(readsCompressed(s)).toBe(false);
    expect(sourceFile(s.id)!.name).toBe('sales.xlsx');
    await syncExcelSources(engine, project());
    expect(useExcelReads.getState().reads[s.id]).toMatchObject({ state: 'ok', sheet: 'Sales', rows: 4 });
    expect((await rows(s.id)).length).toBe(4);
  });
});

describe('an Arrow file', () => {
  it('is loaded as a table with its Arrow types, and dropped when the source goes', async () => {
    const s = await addFileSource(fixture('customers.arrow'));
    expect(s).toMatchObject({ name: 'customers.arrow', format: 'arrow', parseOptions: {} });
    expect(s.archive).toBeUndefined();
    expect(arrowReady(project(), s.id)).toBe(false);
    await syncArrowSources(engine, project());
    expect(arrowReady(project(), s.id)).toBe(true);
    expect(useArrowReads.getState().reads[s.id]).toEqual({ state: 'ok', table: sourceTableName(s), rows: 4, columns: 5 });
    expect(await types(s.id)).toEqual(['id INTEGER', 'name VARCHAR', 'joined DATE', 'balance DOUBLE', 'active BOOLEAN']);
    expect(await rows(s.id)).toEqual([
      { id: 1, name: 'Ada', joined: Date.UTC(2026, 0, 5), balance: 12.5, active: true },
      { id: 2, name: 'Grace', joined: Date.UTC(2026, 1, 10), balance: 8, active: true },
      { id: 3, name: 'Linus', joined: null, balance: null, active: false },
      { id: 4, name: 'Margaret', joined: Date.UTC(2026, 2, 31), balance: 42.25, active: null },
    ]);
    useProjectStore.getState().load(createProject('Empty'));
    await syncArrowSources(engine, project());
    expect(useArrowReads.getState().reads[s.id]).toBeUndefined();
    const tables = tableRows((await engine.query(`SELECT table_name AS t FROM duckdb_tables()`)).table).map((r) => r.t);
    expect(tables).not.toContain(sourceTableName(s));
  });

  it('says what is wrong with a file that isn’t Arrow', async () => {
    // Binary bytes with no signature, named as Arrow: taken from the name, then found not to be.
    const s = await addFileSource(new File([new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x10, 0, 0, 0, 0x0c, 0, 0, 0, 1, 2, 3])], 'broken.feather'));
    expect(s.format).toBe('arrow');
    await syncArrowSources(engine, project());
    expect(useArrowReads.getState().reads[s.id]).toMatchObject({ state: 'failed', message: expect.stringContaining('isn’t an Arrow IPC file') });
    expect(arrowReady(project(), s.id)).toBe(false);
  });
});
