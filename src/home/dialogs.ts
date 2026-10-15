import { create } from 'zustand';

/** Which project dialog is open, from the home screen or the editor's project menu. */
export type ProjectDialog = { kind: 'rename' | 'delete'; id: string; name: string } | null;

export const useProjectDialog = create<{ dialog: ProjectDialog }>(() => ({ dialog: null }));

export const openProjectDialog = (dialog: ProjectDialog) => useProjectDialog.setState({ dialog });
