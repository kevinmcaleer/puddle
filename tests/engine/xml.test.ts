// XML sources end to end below the UI: Puddle's XML reader, the CSV it hands over, and real DuckDB-WASM (Node build)
// typing and reading it through the compiler. Files, web addresses and pasted text.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEngineStore } from '../../src/app/engine';
import { compile, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createProject, removeNodes, setParseOptions, useProjectStore, type Project, type Source } from '../../src/model';
import { addClipboardSource, addFileSource } from '../../src/sources/add';
import { useAttachments } from '../../src/sources/attachments';
import { addUrlSource, loadUrlSource } from '../../src/sources/url';
import { resetXmlSources, syncXmlSources, useXmlReads, withRecord, xmlReady } from '../../src/sources/xml';
import { startFileServer, type FileServer } from '../helpers/fileServer';
import { createNodeBackend } from '../helpers/nodeBackend';

const BOOKS = readFileSync(join(__dirname, '../fixtures/books.xml'));

let engine: EngineClient;
let server: FileServer;

beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
  server = await startFileServer({ cors: true });
  server.files.set('/catalogue', { body: BOOKS, type: 'application/xml' });
});
afterAll(async () => {
  await server.close();
  await engine.close();
});
beforeEach(() => {
  resetXmlSources();
  useAttachments.setState({ sources: {} });
  useProjectStore.getState().load(createProject('XML'));
});

const project = () => useProjectStore.getState().history.present;
const nodeOf = (p: Project, sourceId: string) => p.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId)!.id;
const sync = () => syncXmlSources(engine, project());
const target = (sourceId: string) => compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql;
const rows = async (sourceId: string) => tableRows((await engine.query(target(sourceId))).table);
const types = async (sourceId: string) => (await engine.describe(target(sourceId))).map((c) => `${c.name} ${c.type}`);
const setOptions = (id: string, f: (s: Source) => Source['parseOptions']) => useProjectStore.getState().apply((p) => setParseOptions(p, id, f(p.sources.find((s) => s.id === id)!)));

describe('XML sources', () => {
  it('adds an XML file, finds its records and reads them into typed columns', async () => {
    const s = await addFileSource(new File([BOOKS], 'books.xml'));
    expect(s).toMatchObject({ kind: 'file', format: 'xml', name: 'books.xml', parseOptions: {} });
    expect(xmlReady(project(), s.id)).toBe(false);
    await sync();
    expect(xmlReady(project(), s.id)).toBe(true);
    expect(useXmlReads.getState().reads[s.id]).toMatchObject({
      state: 'ok',
      record: 'catalog/book',
      records: [
        { path: 'catalog/book', count: 3 },
        { path: 'catalog/book/author', count: 4 },
      ],
      expandable: ['author'],
      rows: 3,
      columns: 8,
    });
    expect(await types(s.id)).toEqual(['id VARCHAR', 'format VARCHAR', 'title VARCHAR', 'published DATE', 'price DOUBLE', 'price.currency VARCHAR', 'author VARCHAR', 'stock BIGINT']);
    const r = await rows(s.id);
    // Whitespace is kept for the cleaning steps to deal with; a missing attribute is empty.
    expect(r.map((x) => [x.id, x.format, x.title, x.stock])).toEqual([
      ['bk101', 'paperback', '  Emma ', 12],
      ['bk102', null, 'Good Omens', 0],
      ['bk103', 'hardback', 'Dracula & other stories', 3],
    ]);
    expect(r[1]!.author).toBe('["Terry Pratchett","Neil Gaiman"]');
  });

  it('reads again when the options change, keeps the last read for undo, and lets go of a removed source', async () => {
    const s = await addFileSource(new File([BOOKS], 'books.xml'));
    await sync();
    const first = sourceFileName(project().sources[0]!);

    setOptions(s.id, (x) => ({ ...x.parseOptions, expand: 'author' }));
    expect(xmlReady(project(), s.id)).toBe(false);
    await sync();
    expect((await rows(s.id)).map((x) => [x.id, x.author])).toEqual([
      ['bk101', 'Jane Austen'],
      ['bk102', 'Terry Pratchett'],
      ['bk102', 'Neil Gaiman'],
      ['bk103', 'Bram Stoker'],
    ]);

    // Undo: the earlier read is still registered, so it is ready as soon as the sources are synced, with no re-read.
    useProjectStore.getState().undo();
    expect(sourceFileName(project().sources[0]!)).toBe(first);
    await sync();
    expect(xmlReady(project(), s.id)).toBe(true);
    expect(await rows(s.id)).toHaveLength(3);

    // Another record element drops the expanded element, which belonged to the old record.
    setOptions(s.id, (x) => withRecord({ ...x.parseOptions, expand: 'author' }, 'catalog/book/author'));
    expect(project().sources[0]!.parseOptions).toEqual({ record: 'catalog/book/author' });
    await sync();
    expect((await rows(s.id)).map((x) => x.author)).toEqual(['Jane Austen', 'Terry Pratchett', 'Neil Gaiman', 'Bram Stoker']);

    useProjectStore.getState().apply((p) => removeNodes(p, [nodeOf(p, s.id)]));
    await sync();
    expect(useXmlReads.getState().reads[s.id]).toBeUndefined();
  });

  it('says why a file that isn’t well-formed XML can’t be read', async () => {
    const s = await addFileSource(new File(['<catalog><book></catalog>'], 'broken.xml'));
    await sync();
    expect(xmlReady(project(), s.id)).toBe(false);
    expect(useXmlReads.getState().reads[s.id]).toMatchObject({ state: 'failed', message: 'Line 1: </catalog> is closing <book>. A tag is missing or misspelled.' });
  });

  it('reads pasted XML, stored in the project like any pasted text', async () => {
    const s = await addClipboardSource('<people>\n  <person name="Ann" age="31"/>\n  <person name="Bo" age="4"/>\n</people>');
    expect(s).toMatchObject({ kind: 'clipboard', format: 'xml' });
    await sync();
    expect(await types(s.id)).toEqual(['name VARCHAR', 'age BIGINT']);
    expect(await rows(s.id)).toEqual([
      { name: 'Ann', age: 31 },
      { name: 'Bo', age: 4 },
    ]);
  });

  it('reads XML from a web address, by its Content-Type, and again after a refresh', async () => {
    const s = await addUrlSource(server.url('/catalogue'));
    expect(s).toMatchObject({ kind: 'url', format: 'xml' });
    await sync();
    expect(await rows(s.id)).toHaveLength(3);

    await loadUrlSource(project().sources[0]!, { refresh: true });
    // Fetched again: the new bytes are read again before the source is ready.
    expect(xmlReady(project(), s.id)).toBe(false);
    await sync();
    expect(xmlReady(project(), s.id)).toBe(true);
    expect(await rows(s.id)).toHaveLength(3);
  });
});
