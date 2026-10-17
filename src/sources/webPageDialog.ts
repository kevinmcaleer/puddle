import { create } from 'zustand';

/** Whether the Add source › From web page dialog is open. */
export const useWebPageDialog = create<{ open: boolean }>(() => ({ open: false }));

export const openWebPageDialog = (open = true) => useWebPageDialog.setState({ open });
