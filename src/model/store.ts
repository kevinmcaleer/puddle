import { create } from 'zustand';
import { canRedo, canUndo, checkpoint, initHistory, pushHistory, redo, undo, type History } from './history';
import { createProject } from './project';
import { carryFacts } from './facts';
import { carryPin } from './view';
import type { Project, ProjectView } from './schema';

export interface ProjectState {
  history: History<Project>;
  /** Apply an edit as one undoable step. */
  apply: (edit: (p: Project) => Project) => void;
  /** Replace the project without an undo step (open, import). */
  load: (p: Project) => void;
  /**
   * Put another version of the open project in its place (one pulled from sync) as an undo step, so undo brings back
   * the version it replaced. The version keeps its own `updatedAt`. A different project is loaded instead.
   */
  replace: (p: Project) => void;
  /** Change what the results table views. Not an undoable edit. */
  setView: (view: Partial<ProjectView>) => void;
  /** Record derived facts (such as a source's detected schema) without adding an undo step. */
  amend: (edit: (p: Project) => Project) => void;
  /**
   * Close an editing session: changes `amend`ed in since `before` (such as typing project notes) become one undo
   * step, not one per keystroke.
   */
  checkpoint: (before: Project) => void;
  /**
   * Run one user operation that applies several edits (adding three dropped files, say) as one undo step. `run` may
   * be async; edits applied until it settles join the step. Batches nest: only the outermost records the step.
   */
  batch: <R>(run: () => R) => R;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

const keepLog = (h: History<Project>, from: Project): History<Project> =>
  h.present.exportLog === from.exportLog ? h : { ...h, present: { ...h.present, exportLog: from.exportLog } };

/** Undo and redo keep what isn't an undo step: the export log, the pinned table and comparison, and source facts. */
const keep = (h: History<Project>, from: Project): History<Project> => {
  const logged = keepLog(h, from);
  const facts = carryFacts(logged.present, from);
  const pinned = carryPin(facts, from);
  return pinned === logged.present ? logged : { ...logged, present: pinned };
};

/** The open batch: the project before its first edit, and how deeply batches are nested. */
let batching: { before: Project; depth: number } | null = null;

export const useProjectStore = create<ProjectState>((set, get) => ({
  history: initHistory(createProject()),
  apply: (edit) =>
    set(({ history }) => {
      const next = edit(history.present);
      if (next === history.present) return {};
      // Inside a batch, edits gather in place; the batch records them as one step when it ends.
      if (batching) return { history: { ...history, present: next } };
      return { history: pushHistory(history, { ...next, updatedAt: new Date().toISOString() }) };
    }),
  load: (p) => set({ history: initHistory(p) }),
  replace: (p) => set(({ history }) => ({ history: p.id === history.present.id ? pushHistory(history, p) : initHistory(p) })),
  setView: (view) =>
    set(({ history }) => {
      const next = { ...history.present.view, ...view };
      // Viewing something else stops showing one rule's failing rows, unless the change says otherwise.
      if (!('failingRuleId' in view) && ('viewedNodeId' in view || 'viewedStepIndex' in view)) next.failingRuleId = undefined;
      // Only a viewed node can be pinned, and a node is never compared with itself.
      if (!next.viewedNodeId) next.pinned = false;
      if (next.compare && (!next.pinned || next.compare.nodeId === next.viewedNodeId)) next.compare = undefined;
      return { history: { ...history, present: { ...history.present, view: next } } };
    }),
  amend: (edit) =>
    set(({ history }) => {
      const next = edit(history.present);
      return next === history.present ? {} : { history: { ...history, present: next } };
    }),
  checkpoint: (before) =>
    set(({ history }) => {
      // A session that began in another project (one opened or imported meanwhile) has nothing to record here.
      if (before.id !== history.present.id) return {};
      const next = checkpoint(history, before);
      return next === history ? {} : { history: { ...next, present: { ...next.present, updatedAt: new Date().toISOString() } } };
    }),
  batch: (run) => {
    const outer = !batching;
    if (outer) batching = { before: get().history.present, depth: 0 };
    batching!.depth++;
    const end = () => {
      if (!batching || --batching.depth > 0) return;
      const { before } = batching;
      batching = null;
      get().checkpoint(before);
    };
    let result: ReturnType<typeof run>;
    try {
      result = run();
    } catch (e) {
      end();
      throw e;
    }
    if (result instanceof Promise) return result.finally(end) as typeof result;
    end();
    return result;
  },
  // The export log records what happened, so undo and redo keep the latest one; likewise the pin.
  undo: () => set(({ history }) => ({ history: keep(undo(history), history.present) })),
  redo: () => set(({ history }) => ({ history: keep(redo(history), history.present) })),
  canUndo: () => canUndo(get().history),
  canRedo: () => canRedo(get().history),
}));

export const useProject = () => useProjectStore((s) => s.history.present);
