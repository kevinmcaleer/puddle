import { create } from 'zustand';
import { canRedo, canUndo, initHistory, pushHistory, redo, undo, type History } from './history';
import { createProject } from './project';
import type { Project } from './schema';

export interface ProjectState {
  history: History<Project>;
  /** Apply an edit as one undoable step. */
  apply: (edit: (p: Project) => Project) => void;
  /** Replace the project without an undo step (open, import). */
  load: (p: Project) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  history: initHistory(createProject()),
  apply: (edit) =>
    set(({ history }) => {
      const next = edit(history.present);
      if (next === history.present) return {};
      return { history: pushHistory(history, { ...next, updatedAt: new Date().toISOString() }) };
    }),
  load: (p) => set({ history: initHistory(p) }),
  undo: () => set(({ history }) => ({ history: undo(history) })),
  redo: () => set(({ history }) => ({ history: redo(history) })),
  canUndo: () => canUndo(get().history),
  canRedo: () => canRedo(get().history),
}));

export const useProject = () => useProjectStore((s) => s.history.present);
