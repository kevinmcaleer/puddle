import { create } from 'zustand';
import { useEngineStore } from '../app/engine';
import { useSession } from '../app/session';
import { dropAllKept } from '../flow/kept';
import { resetSample } from '../flow/sample';
import { invalidateCaches } from '../flow/status';
import { createProject, newId, useProjectStore, type Project } from '../model';
import { useResultsStore } from '../results/state';
import { attachProject } from '../sources/attach';
import { copyHandles, deleteHandles, deleteProject, listProjects, loadProject, saveProject, type ProjectSummary } from './db';
import { migrate, projectFileName, readProjectFile, writeProjectFile } from './migrate';

const LAST = 'puddle.lastProject';

interface WorkspaceState {
  screen: 'loading' | 'home' | 'editor';
  projects: ProjectSummary[];
  /** A problem to show on the home screen, e.g. a file that couldn't be imported. */
  error: string | null;
}

export const useWorkspace = create<WorkspaceState>(() => ({ screen: 'loading', projects: [], error: null }));

type Listener<T> = (value: T) => void;

/**
 * What other layers (sync) follow: a project shown in the editor, saved by autosave, or deleted. Listeners run
 * after the fact and aren't awaited.
 */
export const workspaceEvents = {
  shown: new Set<Listener<Project>>(),
  saved: new Set<Listener<Project>>(),
  removed: new Set<Listener<string>>(),
};

const emit = <T>(listeners: Set<Listener<T>>, value: T) => {
  for (const l of listeners) l(value);
};

/** Projects already in IndexedDB. A brand-new, untouched project isn't saved until it has something in it. */
const stored = new Set<string>();

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST, id);
    else localStorage.removeItem(LAST);
  } catch {
    // Storage blocked: the project still autosaves; reopening just starts at the home screen.
  }
}

function lastOpened(): string | null {
  try {
    return localStorage.getItem(LAST);
  } catch {
    return null;
  }
}

export async function refreshProjects() {
  const projects = await listProjects();
  for (const p of projects) stored.add(p.id);
  useWorkspace.setState({ projects });
}

/** Show a project in the editor: load it without history, reset per-tab state and reconnect what can be. */
function show(project: Project) {
  // The last project's kept results go with it.
  void dropAllKept(useEngineStore.getState().engine);
  invalidateCaches();
  resetSample();
  useSession.setState({ selectedNodeId: null, selectedNodeIds: [], selectedStepId: null, selectedColumns: [], notice: null });
  useResultsStore.getState().set({ rows: undefined, cols: undefined, ms: undefined, profile: undefined });
  useProjectStore.getState().load(project);
  remember(project.id);
  useWorkspace.setState({ screen: 'editor', error: null });
  emit(workspaceEvents.shown, project);
  return attachProject(project);
}

/** A project is saved once it has been edited; opening a blank one and leaving it doesn't clutter the list. */
const worthSaving = (p: Project, edited: boolean) => stored.has(p.id) || edited || p.sources.length > 0 || p.nodes.length > 0 || p.notes.length > 0;

let pending: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> = Promise.resolve();

/** Save the open project now (autosave calls this after a short pause, and on leaving the page). */
export function flush(): Promise<void> {
  if (pending) clearTimeout(pending);
  pending = null;
  if (useWorkspace.getState().screen !== 'editor') return saving;
  const { history } = useProjectStore.getState();
  const project = history.present;
  if (!worthSaving(project, history.past.length > 0 || history.future.length > 0)) return saving;
  saving = saving
    .then(() => saveProject(project))
    .then(() => {
      stored.add(project.id);
      emit(workspaceEvents.saved, project);
    })
    .catch((e: unknown) => useSession.getState().notify({ tone: 'fail', text: `Puddle couldn’t save this project in the browser: ${e instanceof Error ? e.message : String(e)}` }));
  return saving;
}

/** Autosave the open project to IndexedDB, a moment after each change. */
export function startAutosave(delay = 400) {
  let last = useProjectStore.getState().history.present;
  const off = useProjectStore.subscribe((s) => {
    if (s.history.present === last) return;
    last = s.history.present;
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => void flush(), delay);
  });
  const onHide = () => document.visibilityState === 'hidden' && void flush();
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  return () => {
    off();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
  };
}

/**
 * Start the app: reopen the last project, or go straight into a new one on first run, or show the home screen.
 */
let started = false;

export async function startWorkspace() {
  if (started) return;
  started = true;
  try {
    await refreshProjects();
  } catch (e) {
    // IndexedDB blocked (some private windows): work in a single unsaved project.
    useWorkspace.setState({ error: `Projects can’t be saved in this browser window: ${e instanceof Error ? e.message : String(e)}` });
    return newProject();
  }
  const last = lastOpened();
  if (last && stored.has(last) && (await openProject(last).then(() => true, () => false))) return;
  if (!useWorkspace.getState().projects.length) return newProject();
  remember(null);
  useWorkspace.setState({ screen: 'home' });
}

export async function openProject(id: string) {
  await flush();
  const raw = await loadProject(id);
  if (!raw) throw new Error('That project no longer exists.');
  await show(migrate(raw));
}

export function newProject(name?: string) {
  void flush();
  return show(createProject(name));
}

export async function goHome() {
  // Forget the open project first, so a reload straight after this lands on the home screen too.
  remember(null);
  await flush();
  await refreshProjects();
  useWorkspace.setState({ screen: 'home' });
  await dropAllKept(useEngineStore.getState().engine);
}

export async function renameProject(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const open = useProjectStore.getState().history.present;
  if (useWorkspace.getState().screen === 'editor' && open.id === id) {
    useProjectStore.getState().apply((p) => ({ ...p, name: trimmed }));
    await flush();
  } else {
    const p = await loadProject(id);
    if (p) await saveProject({ ...p, name: trimmed, updatedAt: new Date().toISOString() });
  }
  await refreshProjects();
}

/** A copy with a new id, the same sources and graph, saved straight away. */
export async function duplicateProject(id: string): Promise<string> {
  await flush();
  const p = await loadProject(id);
  if (!p) throw new Error('That project no longer exists.');
  const now = new Date().toISOString();
  const copy = { ...migrate(p), id: newId('p'), name: `${p.name} copy`, createdAt: now, updatedAt: now };
  await saveProject(copy);
  // The copy's sources keep their ids, so on Chromium its files reconnect the same way as the original's.
  await copyHandles(id, copy.id).catch(() => {});
  await refreshProjects();
  return copy.id;
}

export async function removeProject(id: string) {
  if (pending) clearTimeout(pending);
  await deleteProject(id);
  await deleteHandles(id).catch(() => {});
  stored.delete(id);
  emit(workspaceEvents.removed, id);
  if (lastOpened() === id) remember(null);
  await refreshProjects();
}

/** Save a project in place of any of the same id (such as a newer version from sync) and show it in the editor. */
export async function replaceProject(project: Project) {
  // Anything still unsaved goes first, so it can't land on top of the new version afterwards.
  await flush();
  await saveProject(project);
  stored.add(project.id);
  await show(project);
}

/**
 * Save the open project now, even if it is untouched, so the page can leave (to sign in to Google Drive) and reopen
 * it on coming back.
 */
export async function keepOpenProject() {
  await flush();
  if (useWorkspace.getState().screen !== 'editor') return;
  const project = useProjectStore.getState().history.present;
  if (stored.has(project.id)) return;
  await saveProject(project);
  stored.add(project.id);
}

/** Save a project beside the others without opening it. */
export async function saveProjectCopy(project: Project) {
  await saveProject(project);
  stored.add(project.id);
  await refreshProjects();
}

/** Import a `.puddle.json` file and open it. An id already in use gets a new one, so nothing is overwritten. */
export async function importProject(file: File) {
  try {
    const project = readProjectFile(await file.text());
    const id = stored.has(project.id) ? newId('p') : project.id;
    const imported = { ...project, id };
    // A project file carries no file handles; never pair it with ones left under the same id.
    await deleteHandles(id).catch(() => {});
    await saveProject(imported);
    stored.add(id);
    await show(imported);
  } catch (e) {
    useWorkspace.setState({ error: e instanceof Error ? e.message : String(e) });
    useSession.getState().notify({ tone: 'fail', text: e instanceof Error ? e.message : String(e) });
  }
}

/** Download the open project as `.puddle.json`: the steps, never the data. */
export function exportProject() {
  const project = useProjectStore.getState().history.present;
  const url = URL.createObjectURL(new Blob([writeProjectFile(project)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = projectFileName(project);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
