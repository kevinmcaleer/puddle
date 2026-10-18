import { create } from 'zustand';

/** Whether the Add source › From OData feed dialog is open. */
export const useODataDialog = create<{ open: boolean }>(() => ({ open: false }));

export const openODataDialog = (open = true) => useODataDialog.setState({ open });
