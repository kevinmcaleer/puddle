import { create } from 'zustand';
import { canRedo, canUndo, checkpoint, initHistory, pushHistory, redo, undo, type History } from './history';
import { createProject } from './project';
import { carryPin } from './view';
import type { Project, ProjectView } from './schema';

export interface ProjectState {
  history: History<Project>;
  /** Apply an edit as one undoable step. */
  apply: (edit: (p: Project) => Project) => void;
  /** Replace the project without an undo step (open, import). */
  load: (p: Project) => void;
  /** Change what the results table views. Not an undoable edit. */
  setView: (view: Partial<ProjectView>) => void;
  /** Record derived facts (such as a source's detected schema) without adding an undo step. */
  amend: (edit: (p: Project) => Project) => void;
  /**
   * Close an editing session: changes `amend`ed in since `before` (such as typing project notes) become one undo
   * step, not one per keystroke.
   */
  checkpoint: (before: Project) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

const keepLog = (h: History<Project>, from: Project): History<Project> =>
  h.present.exportLog === from.exportLog ? h : { ...h, present: { ...h.present, exportLog: from.exportLog } };

/** Undo and redo keep what isn't an undo step: the export log, and the pinned table and comparison. */
const keep = (h: History<Project>, from: Project): History<Project> => {
  const logged = keepLog(h, from);
  const pinned = carryPin(logged.present, from);
  return pinned === logged.present ? logged : { ...logged, present: pinned };
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  history: initHistory(createProject()),
  apply: (edit) =>
    set(({ history }) => {
      const next = edit(history.present);
      if (next === history.present) return {};
      return { history: pushHistory(history, { ...next, updatedAt: new Date().toISOString() }) };
    }),
  load: (p) => set({ history: initHistory(p) }),
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
  // The export log records what happened, so undo and redo keep the latest one; likewise the pin.
  undo: () => set(({ history }) => ({ history: keep(undo(history), history.present) })),
  redo: () => set(({ history }) => ({ history: keep(redo(history), history.present) })),
  canUndo: () => canUndo(get().history),
  canRedo: () => canRedo(get().history),
}));

export const useProject = () => useProjectStore((s) => s.history.present);
