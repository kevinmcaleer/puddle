import { create } from 'zustand';
import { useProjectStore } from '../model';
import { saveHandle } from '../persistence/db';
import { ACCEPT } from './detect';

/**
 * Chromium's File System Access API, which lets a project keep a handle to each file it reads so that reopening it
 * needs a permission click instead of a file dialog (plan D6). Other browsers lack it and keep choosing files.
 * Only the members Puddle uses are typed here; TypeScript's DOM library doesn't carry the Chromium-only ones.
 */
export interface FileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  queryPermission?(d: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'read' }): Promise<PermissionState>;
}

interface PickerOptions {
  multiple?: boolean;
  id?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

interface PickerHost {
  showOpenFilePicker?: (options?: PickerOptions) => Promise<FileHandle[]>;
}

/** A file and, where the browser gave one, the handle to open it again later. */
export interface PickedFile {
  file: File;
  handle?: FileHandle;
}

/** True where files can be opened through handles that survive a reload (Chromium). */
export const supportsFileHandles = (host: unknown = globalThis): boolean => typeof (host as PickerHost | undefined)?.showOpenFilePicker === 'function';

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/**
 * Choose files with the browser's file picker and keep their handles. Returns null where the picker isn't available
 * (or refuses, e.g. in a cross-origin frame), meaning: fall back to an `<input type="file">`. Cancelling returns [].
 */
export async function pickFiles(multiple: boolean, host: unknown = globalThis): Promise<PickedFile[] | null> {
  if (!supportsFileHandles(host)) return null;
  const extensions = ACCEPT.split(',').filter((x) => x.startsWith('.'));
  let handles: FileHandle[];
  try {
    handles = await (host as Required<PickerHost>).showOpenFilePicker({
      multiple,
      id: 'puddle-sources',
      types: [{ description: 'Data files', accept: { 'application/octet-stream': extensions } }],
    });
  } catch (e) {
    if (isAbort(e)) return [];
    return null;
  }
  return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
}

interface DropItem {
  kind: string;
  getAsFileSystemHandle?: () => Promise<{ kind: string; name: string } | null>;
}

/**
 * The files dropped on the canvas, each with its handle where the browser gives one. Handles must be asked for
 * during the drop event itself, before anything is awaited, so this does that first.
 */
export async function droppedFiles(data: { items?: ArrayLike<DropItem>; files: ArrayLike<File> }, host: unknown = globalThis): Promise<PickedFile[]> {
  const files = Array.from(data.files);
  if (!supportsFileHandles(host) || !data.items) return files.map((file) => ({ file }));
  const pending = Array.from(data.items)
    .filter((i) => i.kind === 'file')
    .map((i) => (i.getAsFileSystemHandle ? i.getAsFileSystemHandle().catch(() => null) : Promise.resolve(null)));
  const handles = (await Promise.all(pending)).filter((h): h is FileHandle => h?.kind === 'file');
  return files.map((file) => {
    const at = handles.findIndex((h) => h.name === file.name);
    return at < 0 ? { file } : { file, handle: handles.splice(at, 1)[0] };
  });
}

/** Keep a source's file handle for next time. Failing to keep it only means choosing the file again later. */
export function keepHandle(sourceId: string, handle: FileHandle | undefined) {
  if (!handle) return;
  const projectId = useProjectStore.getState().history.present.id;
  saveHandle(projectId, sourceId, handle).catch(() => {});
}

/** Handles from last time still waiting for a permission click, and why some sources still need choosing. */
interface ReconnectState {
  /** By source id: stored handles not yet connected. */
  pending: Record<string, FileHandle>;
  /** By source id: why reconnecting this file didn't work, in plain words. */
  reasons: Record<string, string>;
  busy: boolean;
}

export const useReconnect = create<ReconnectState>(() => ({ pending: {}, reasons: {}, busy: false }));

/** A source is connected again (or chosen afresh): it no longer waits or carries a reason. */
export function settleSource(sourceId: string) {
  const { pending, reasons } = useReconnect.getState();
  if (!(sourceId in pending) && !(sourceId in reasons)) return;
  const { [sourceId]: _p, ...restPending } = pending;
  const { [sourceId]: _r, ...restReasons } = reasons;
  useReconnect.setState({ pending: restPending, reasons: restReasons });
}

/** Connect a source to the file behind its handle; the caller registers it with DuckDB and checks its hash. */
export type Connect = (sourceId: string, file: File, handle: FileHandle) => Promise<unknown>;

/** The plain-words reason a stored handle couldn't be read. */
export function handleFailure(name: string, e: unknown): string {
  const kind = e instanceof DOMException ? e.name : '';
  if (kind === 'NotFoundError') return `${name} isn’t where it was. It may have been moved, renamed or deleted; choose it again.`;
  if (kind === 'NotAllowedError' || kind === 'SecurityError') return `Puddle wasn’t allowed to read ${name}. Choose it again.`;
  return `${name} couldn’t be opened again (${e instanceof Error ? e.message : String(e)}). Choose it again.`;
}

async function open(sourceId: string, handle: FileHandle, connect: Connect): Promise<string | null> {
  try {
    await connect(sourceId, await handle.getFile(), handle);
    return null;
  } catch (e) {
    return handleFailure(handle.name, e);
  }
}

/**
 * When a project opens: keep its stored handles for the sources that need a file, and connect straight away the
 * ones the browser already allows (Chromium can remember the permission between visits).
 */
export async function offerHandles(handles: Map<string, FileHandle>, connect: Connect): Promise<void> {
  const pending: Record<string, FileHandle> = {};
  const reasons: Record<string, string> = {};
  for (const [sourceId, handle] of handles) {
    let state: PermissionState = 'prompt';
    try {
      state = (await handle.queryPermission?.({ mode: 'read' })) ?? 'prompt';
    } catch {
      // Treat an unanswerable query as needing the click.
    }
    if (state === 'granted') {
      const reason = await open(sourceId, handle, connect);
      if (reason) reasons[sourceId] = reason;
    } else if (state === 'prompt') pending[sourceId] = handle;
    // 'denied': the browser won't ask again, so the file is chosen as before.
    else reasons[sourceId] = `Puddle wasn’t allowed to read ${handle.name}. Choose it again.`;
  }
  useReconnect.setState({ pending, reasons, busy: false });
}

/**
 * "Reconnect files": ask for permission on every waiting handle in one click, and connect each one granted.
 * A refusal or a file that has moved falls back to choosing the file, with the reason. A request the browser
 * wouldn't show (it needs a fresh click) stays waiting for the next click.
 */
export async function reconnectAll(connect: Connect): Promise<void> {
  const { pending, busy } = useReconnect.getState();
  if (busy) return;
  useReconnect.setState({ busy: true });
  const waiting: Record<string, FileHandle> = {};
  const reasons: Record<string, string> = { ...useReconnect.getState().reasons };
  for (const [sourceId, handle] of Object.entries(pending)) {
    let state: PermissionState;
    try {
      state = handle.requestPermission ? await handle.requestPermission({ mode: 'read' }) : 'granted';
    } catch {
      waiting[sourceId] = handle;
      continue;
    }
    if (state !== 'granted') {
      reasons[sourceId] = `Permission to read ${handle.name} was refused. Choose it again.`;
      continue;
    }
    const reason = await open(sourceId, handle, connect);
    if (reason) reasons[sourceId] = reason;
    else delete reasons[sourceId];
  }
  useReconnect.setState({ pending: waiting, reasons, busy: false });
}
