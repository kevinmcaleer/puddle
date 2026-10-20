import { create } from 'zustand';

/**
 * The connections dialog: from Add source › From database (`add`, to pick or make a connection for a source) or from
 * Project › Databases (`manage`, to look after the project's connections). `editId` opens straight on a connection's form.
 */
export interface ConnectionDialogState {
  mode: 'add' | 'manage' | null;
  editId?: string;
  /** Open straight on the table picker of this connection (a database file just dropped in). */
  pickId?: string;
}

export const useConnectionDialog = create<ConnectionDialogState>(() => ({ mode: null }));

export const openConnectionDialog = (mode: 'add' | 'manage' = 'add', editId?: string) => useConnectionDialog.setState({ mode, editId, pickId: undefined });
export const openTablePicker = (pickId: string) => useConnectionDialog.setState({ mode: 'add', editId: undefined, pickId });
export const closeConnectionDialog = () => useConnectionDialog.setState({ mode: null, editId: undefined, pickId: undefined });
