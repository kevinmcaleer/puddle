import { create } from 'zustand';

/** Whether the Add source › From URL dialog is open. */
export const useUrlDialog = create<{ open: boolean }>(() => ({ open: false }));

export const openUrlDialog = (open = true) => useUrlDialog.setState({ open });
