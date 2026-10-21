// Log files (#193) on real DuckDB-WASM through the rewrite path: each fixture under tests/fixtures/logs/ is sniffed
// to its preset and opens to typed rows; the Lines option switches the preset, and a custom pattern reads by its groups.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEngineStore } from '../../src/app/engine';
import { compile } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { createProject, setParseOptions, useProjectStore, type Project } from '../../src/model';
import { addClipboardSource, addFileSource } from '../../src/sources/add';
import { useAttachments } from '../../src/sources/attachments';
import { resetRewrites, syncRewrites, useRewrites } from '../../src/sources/rewrite';
import { createNodeBackend } from '../helpers/nodeBackend';

const fixture = (name: string) => new File([readFileSync(join(__dirname, '../fixtures/logs', name)) as Uint8Array<ArrayBuffer>], name);

let engine: EngineClient;
beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } });
});
afterAll(() => engine.close());
beforeEach(() => {
  resetRewrites();
  useAttachments.setState({ sources: {} });
  useProjectStore.getState().load(createProject('Logs'));
});

const project = () => useProjectStore.getState().history.present;
const nodeOf = (p: Project, sourceId: string) => p.nodes.find((n) => n.type === 'source' && n.sourceId === sourceId)!.id;
const rows = async (sourceId: string) => tableRows((await engine.query(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).table);
const types = async (sourceId: string) => (await engine.describe(compile(project(), { nodeId: nodeOf(project(), sourceId) }).sql)).map((c) => `${c.name} ${c.type}`);
const sync = () => syncRewrites(engine, project());

describe('log files', () => {
  it('opens an access log as typed rows, with the time a timestamp and the status a number, and counts the lines that didn’t fit', async () => {
    const s = await addFileSource(fixture('access.log'));
    expect(s).toMatchObject({ format: 'log', parseOptions: { preset: 'combined' } });
    await sync();
    expect(useRewrites.getState().reads[s.id]).toMatchObject({ state: 'ok', rows: 4, columns: 11, preset: 'combined', unmatched: 1 });
    expect(await types(s.id)).toEqual(['host VARCHAR', 'ident VARCHAR', 'user VARCHAR', 'time TIMESTAMP WITH TIME ZONE', 'method VARCHAR', 'path VARCHAR', 'protocol VARCHAR', 'status BIGINT', 'bytes BIGINT', 'referrer VARCHAR', 'agent VARCHAR']);
    expect((await rows(s.id))[2]).toMatchObject({ host: '198.51.100.23', user: null, method: 'GET', path: '/missing', status: 404, bytes: null, referrer: null });
  });

  it('switches an app log to a custom pattern, and reads a syslog pasted in', async () => {
    const s = await addFileSource(fixture('app.log'));
    expect(s.parseOptions).toEqual({ preset: 'timestamped' });
    await sync();
    expect(await types(s.id)).toEqual(['time VARCHAR', 'level VARCHAR', 'message VARCHAR']);
    expect((await rows(s.id))[3]).toMatchObject({ level: 'ERROR', message: expect.stringContaining('ValueError: no rows') });
    useProjectStore.getState().apply((p) => setParseOptions(p, s.id, { preset: 'custom', pattern: '^(?<day>\\d{4}-\\d{2}-\\d{2})\\D(?<clock>\\d{2}:\\d{2}:\\d{2})' }));
    await sync();
    expect(useRewrites.getState().reads[s.id]).toMatchObject({ state: 'ok', rows: 5, columns: 2, unmatched: 3 });
    expect(await types(s.id)).toEqual(['day DATE', 'clock TIME']);
    useProjectStore.getState().apply((p) => setParseOptions(p, s.id, { preset: 'custom', pattern: '(' }));
    await sync();
    expect(useRewrites.getState().reads[s.id]).toMatchObject({ state: 'failed', message: expect.stringContaining('isn’t a regular expression JavaScript accepts') });

    const pasted = await addClipboardSource(readFileSync(join(__dirname, '../fixtures/logs/syslog.log'), 'utf8'));
    expect(pasted).toMatchObject({ format: 'log', parseOptions: { preset: 'syslog' } });
    await sync();
    expect((await rows(pasted.id))[3]).toMatchObject({ priority: 34, process: 'puddle-run', pid: 2048, message: 'Output written: 3 rows' });
  });
});
