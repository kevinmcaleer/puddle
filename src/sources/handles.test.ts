import { droppedFiles, handleFailure, offerHandles, pickFiles, reconnectAll, settleSource, supportsFileHandles, useReconnect, type FileHandle } from './handles';

const file = (name: string, text = 'a,b\n1,2\n') => new File([text], name);

/** A stand-in for Chromium's FileSystemFileHandle, with the permission answers a test needs. */
function fakeHandle(name: string, opts: { query?: PermissionState; request?: PermissionState | Error; getFile?: Error } = {}) {
  const calls = { request: 0 };
  const handle: FileHandle = {
    kind: 'file',
    name,
    getFile: () => (opts.getFile ? Promise.reject(opts.getFile) : Promise.resolve(file(name))),
    queryPermission: () => Promise.resolve(opts.query ?? 'prompt'),
    requestPermission: () => {
      calls.request++;
      return opts.request instanceof Error ? Promise.reject(opts.request) : Promise.resolve(opts.request ?? 'granted');
    },
  };
  return { handle, calls };
}

/** Browsers without the File System Access API, as Firefox and WebKit ship today. */
const firefoxLike = { navigator: {}, indexedDB: {} };
const chromiumLike = (picker: (o?: unknown) => Promise<FileHandle[]>) => ({ showOpenFilePicker: picker });

const reset = () => useReconnect.setState({ pending: {}, reasons: {}, busy: false });
beforeEach(reset);

describe('feature detection', () => {
  it('uses handles only where the browser has the file picker', () => {
    expect(supportsFileHandles(chromiumLike(() => Promise.resolve([])))).toBe(true);
    expect(supportsFileHandles(firefoxLike)).toBe(false);
    expect(supportsFileHandles({ showOpenFilePicker: 'not a function' })).toBe(false);
    expect(supportsFileHandles(undefined)).toBe(false);
  });
});

describe('pickFiles', () => {
  it('falls back to the file input in browsers without the picker', async () => {
    expect(await pickFiles(true, firefoxLike)).toBeNull();
  });

  it('returns each chosen file with its handle, offering the formats Puddle reads', async () => {
    const a = fakeHandle('a.csv').handle;
    const b = fakeHandle('b.parquet').handle;
    let options: { multiple?: boolean; types?: { accept: Record<string, string[]> }[] } | undefined;
    const picked = await pickFiles(true, chromiumLike((o) => ((options = o as typeof options), Promise.resolve([a, b]))));
    expect(picked!.map((p) => [p.file.name, p.handle])).toEqual([['a.csv', a], ['b.parquet', b]]);
    expect(options!.multiple).toBe(true);
    expect(Object.values(options!.types![0]!.accept)[0]).toEqual(expect.arrayContaining(['.csv', '.tsv', '.json', '.parquet']));
  });

  it('treats a cancelled picker as nothing chosen, and a refused one as no picker', async () => {
    expect(await pickFiles(false, chromiumLike(() => Promise.reject(new DOMException('The user aborted a request.', 'AbortError'))))).toEqual([]);
    expect(await pickFiles(false, chromiumLike(() => Promise.reject(new DOMException('Cross origin sub frames aren’t allowed', 'SecurityError'))))).toBeNull();
  });
});

describe('droppedFiles', () => {
  const item = (h: { kind: string; name: string } | null) => ({ kind: 'file', getAsFileSystemHandle: vi.fn(() => Promise.resolve(h)) });

  it('pairs each dropped file with its handle by name, skipping folders', async () => {
    const a = fakeHandle('a.csv').handle;
    const b = fakeHandle('b.csv').handle;
    const items = [item(b), item({ kind: 'directory', name: 'folder' }), item(a)];
    const got = await droppedFiles({ items, files: [file('a.csv'), file('b.csv'), file('c.csv')] }, chromiumLike(() => Promise.resolve([])));
    expect(got.map((g) => [g.file.name, g.handle?.name])).toEqual([['a.csv', 'a.csv'], ['b.csv', 'b.csv'], ['c.csv', undefined]]);
  });

  it('asks for every handle before awaiting anything, while the drop data is readable', async () => {
    const items = [item(fakeHandle('a.csv').handle), item(fakeHandle('b.csv').handle)];
    const pending = droppedFiles({ items, files: [file('a.csv'), file('b.csv')] }, chromiumLike(() => Promise.resolve([])));
    for (const i of items) expect(i.getAsFileSystemHandle).toHaveBeenCalledTimes(1);
    await pending;
  });

  it('keeps today’s behaviour in other browsers: plain files, no handle asked for', async () => {
    const items = [item(fakeHandle('a.csv').handle)];
    const got = await droppedFiles({ items, files: [file('a.csv')] }, firefoxLike);
    expect(got).toEqual([{ file: expect.any(File) }]);
    expect(items[0]!.getAsFileSystemHandle).not.toHaveBeenCalled();
  });

  it('copes with a refused handle', async () => {
    const items = [{ kind: 'file', getAsFileSystemHandle: () => Promise.reject(new Error('nope')) }];
    expect(await droppedFiles({ items, files: [file('a.csv')] }, chromiumLike(() => Promise.resolve([])))).toEqual([{ file: expect.any(File) }]);
  });
});

describe('offerHandles', () => {
  it('connects files already allowed, keeps the rest for one click, and says why denied ones need choosing', async () => {
    const connected: string[] = [];
    const connect = vi.fn((id: string, f: File) => (connected.push(`${id}:${f.name}`), Promise.resolve()));
    await offerHandles(
      new Map([
        ['s1', fakeHandle('a.csv', { query: 'granted' }).handle],
        ['s2', fakeHandle('b.csv', { query: 'prompt' }).handle],
        ['s3', fakeHandle('c.csv', { query: 'denied' }).handle],
        ['s4', fakeHandle('gone.csv', { query: 'granted', getFile: new DOMException('A requested file could not be found', 'NotFoundError') }).handle],
      ]),
      connect,
    );
    expect(connected).toEqual(['s1:a.csv']);
    const { pending, reasons } = useReconnect.getState();
    expect(Object.keys(pending)).toEqual(['s2']);
    expect(reasons.s3).toContain('wasn’t allowed to read c.csv');
    expect(reasons.s4).toContain('gone.csv isn’t where it was');
  });
});

describe('reconnectAll', () => {
  it('asks once per file in one click and connects every file allowed, with no file dialog', async () => {
    const a = fakeHandle('a.csv');
    const b = fakeHandle('b.csv');
    const c = fakeHandle('c.csv');
    useReconnect.setState({ pending: { s1: a.handle, s2: b.handle, s3: c.handle } });
    const connect = vi.fn(() => Promise.resolve());
    await reconnectAll(connect);
    expect([a, b, c].map((x) => x.calls.request)).toEqual([1, 1, 1]);
    expect(connect.mock.calls.map((call) => (call as unknown[])[0])).toEqual(['s1', 's2', 's3']);
    expect(useReconnect.getState()).toMatchObject({ pending: {}, reasons: {}, busy: false });
  });

  it('falls back to choosing the file, with the reason, when permission is refused or the file has moved', async () => {
    useReconnect.setState({
      pending: {
        s1: fakeHandle('a.csv', { request: 'denied' }).handle,
        s2: fakeHandle('b.csv', { getFile: new DOMException('A requested file could not be found', 'NotFoundError') }).handle,
      },
    });
    const connect = vi.fn(() => Promise.resolve());
    await reconnectAll(connect);
    expect(connect).not.toHaveBeenCalled();
    const { pending, reasons } = useReconnect.getState();
    expect(pending).toEqual({});
    expect(reasons.s1).toBe('Permission to read a.csv was refused. Choose it again.');
    expect(reasons.s2).toContain('b.csv isn’t where it was');
  });

  it('keeps a file waiting when the browser wouldn’t ask without a fresh click', async () => {
    const later = fakeHandle('b.csv', { request: new DOMException('User activation is required to request permissions.', 'SecurityError') });
    useReconnect.setState({ pending: { s1: fakeHandle('a.csv').handle, s2: later.handle } });
    await reconnectAll(() => Promise.resolve());
    expect(Object.keys(useReconnect.getState().pending)).toEqual(['s2']);
    expect(useReconnect.getState().reasons).toEqual({});
  });

  it('reports a file that couldn’t be connected, such as one of another format', async () => {
    useReconnect.setState({ pending: { s1: fakeHandle('a.csv').handle } });
    await reconnectAll(() => Promise.reject(new Error('a.csv isn’t a PARQUET file.')));
    expect(useReconnect.getState().reasons.s1).toContain('a.csv isn’t a PARQUET file.');
  });

  it('ignores a second click while the first is still working', async () => {
    const a = fakeHandle('a.csv');
    useReconnect.setState({ pending: { s1: a.handle }, busy: true });
    await reconnectAll(() => Promise.resolve());
    expect(a.calls.request).toBe(0);
  });
});

describe('settleSource', () => {
  it('clears a source chosen by hand from the waiting list and its reason', () => {
    const a = fakeHandle('a.csv').handle;
    useReconnect.setState({ pending: { s1: a, s2: a }, reasons: { s1: 'why' } });
    settleSource('s1');
    expect(Object.keys(useReconnect.getState().pending)).toEqual(['s2']);
    expect(useReconnect.getState().reasons).toEqual({});
  });

  it('words failures plainly', () => {
    expect(handleFailure('a.csv', new DOMException('x', 'NotAllowedError'))).toBe('Puddle wasn’t allowed to read a.csv. Choose it again.');
  });
});
