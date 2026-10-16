// Reopening a project through stored file handles, end to end on real DuckDB-WASM (Node build): the File from the
// handle is registered with the engine, its head hash is checked, and the source reads.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEngineStore } from '../../src/app/engine';
import { compilePreview } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { useProjectStore, type Project } from '../../src/model';
import { loadHandles } from '../../src/persistence/db';
import { attachProject, connectHandle } from '../../src/sources/attach';
import { useAttachments } from '../../src/sources/attachments';
import { reconnectAll, useReconnect, type FileHandle } from '../../src/sources/handles';
import { headHash } from '../../src/sources/hash';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

vi.mock('../../src/persistence/db', async (original) => ({
  ...(await original<typeof import('../../src/persistence/db')>()),
  loadHandles: vi.fn(),
  deleteHandles: vi.fn(() => Promise.resolve()),
  saveHandle: vi.fn(() => Promise.resolve()),
}));

const text = (name: string) => readFileSync(join(__dirname, '../fixtures', name));
const fixtureFile = (name: string) => new File([text(name)], name);
const GAPS_ROWS = text('gaps.csv').toString('utf8').trim().split('\n').length - 1;

const handle = (file: File, opts: { query?: PermissionState; request?: PermissionState; moved?: boolean } = {}): FileHandle => ({
  kind: 'file',
  name: file.name,
  getFile: () => (opts.moved ? Promise.reject(new DOMException('A requested file or directory could not be found', 'NotFoundError')) : Promise.resolve(file)),
  queryPermission: () => Promise.resolve(opts.query ?? 'prompt'),
  requestPermission: () => Promise.resolve(opts.request ?? 'granted'),
});

let engine: EngineClient;
let hash: string;
let n = 0;

beforeAll(async () => {
  engine = new EngineClient(await createNodeBackend());
  useEngineStore.setState({ engine });
  hash = await headHash(fixtureFile('customers.csv'));
});
afterAll(() => engine.close());

/**
 * A reopened project with two file sources, both built on customers.csv. Ids are fresh for each test, because files
 * chosen earlier in the same tab stay attached.
 */
function reopened(): { project: Project; a: string; b: string } {
  const [a, b] = [`a${++n}`, `b${n}`];
  const file = { originalName: 'customers.csv', size: 1, lastModified: 0, headHash: hash };
  const project = flow({
    sources: [src({ id: a, format: 'csv', file }), src({ id: b, format: 'csv', file: { ...file, originalName: 'gaps.csv' } })],
    nodes: [
      { id: `n${a}`, type: 'source', sourceId: a },
      { id: `n${b}`, type: 'source', sourceId: b },
    ],
  });
  useProjectStore.getState().load(project);
  return { project, a, b };
}

const withPicker = () => ((globalThis as { showOpenFilePicker?: unknown }).showOpenFilePicker = () => Promise.resolve([]));

beforeEach(() => {
  useReconnect.setState({ pending: {}, reasons: {}, busy: false });
  vi.mocked(loadHandles).mockReset();
});
afterEach(() => {
  delete (globalThis as { showOpenFilePicker?: unknown }).showOpenFilePicker;
});

const rowsOf = async (nodeId: string) => tableRows((await engine.query(compilePreview(useProjectStore.getState().history.present, { nodeId }))).table);

describe('reopening through stored file handles', () => {
  it('reconnects every file with one click and no file dialog; a different file still warns', async () => {
    withPicker();
    const { project, a, b } = reopened();
    vi.mocked(loadHandles).mockResolvedValue(new Map([[a, handle(fixtureFile('customers.csv'))], [b, handle(fixtureFile('gaps.csv'))]]));
    await attachProject(project);
    expect(useAttachments.getState().sources).toEqual({ [a]: 'detached', [b]: 'detached' });
    expect(Object.keys(useReconnect.getState().pending)).toEqual([a, b]);

    await reconnectAll(connectHandle);
    // gaps.csv isn't the file this source was built on (its head hash differs), so it attaches with a warning.
    expect(useAttachments.getState().sources).toEqual({ [a]: 'attached', [b]: 'mismatch' });
    expect(useReconnect.getState().pending).toEqual({});
    expect(await rowsOf(`n${a}`)).toHaveLength(4);
    expect(await rowsOf(`n${b}`)).toHaveLength(GAPS_ROWS);
  });

  it('connects files the browser already allows as soon as the project opens', async () => {
    withPicker();
    const { project, a, b } = reopened();
    vi.mocked(loadHandles).mockResolvedValue(new Map([[a, handle(fixtureFile('customers.csv'), { query: 'granted' })]]));
    await attachProject(project);
    expect(useAttachments.getState().sources).toEqual({ [a]: 'attached', [b]: 'detached' });
    expect(useReconnect.getState().pending).toEqual({});
    expect(await rowsOf(`n${a}`)).toHaveLength(4);
  });

  it('leaves a moved file or a refused one to be chosen again, with the reason', async () => {
    withPicker();
    const { project, a, b } = reopened();
    vi.mocked(loadHandles).mockResolvedValue(
      new Map([
        [a, handle(fixtureFile('customers.csv'), { moved: true })],
        [b, handle(fixtureFile('gaps.csv'), { request: 'denied' })],
      ]),
    );
    await attachProject(project);
    await reconnectAll(connectHandle);
    expect(useAttachments.getState().sources).toEqual({ [a]: 'detached', [b]: 'detached' });
    expect(useReconnect.getState().reasons).toEqual({
      [a]: 'customers.csv isn’t where it was. It may have been moved, renamed or deleted; choose it again.',
      [b]: 'Permission to read gaps.csv was refused. Choose it again.',
    });
  });

  it('in browsers without file handles (Firefox, WebKit), never looks for them: files are chosen as before', async () => {
    const { project, a, b } = reopened();
    vi.mocked(loadHandles).mockResolvedValue(new Map([[a, handle(fixtureFile('customers.csv'), { query: 'granted' })]]));
    await attachProject(project);
    expect(loadHandles).not.toHaveBeenCalled();
    expect(useAttachments.getState().sources).toEqual({ [a]: 'detached', [b]: 'detached' });
    expect(useReconnect.getState()).toMatchObject({ pending: {}, reasons: {} });
  });
});
