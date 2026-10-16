import { create } from 'zustand';

/** Whether the Try a sample dialog is open (from the empty canvas). */
export const useSamplesDialog = create<{ open: boolean }>(() => ({ open: false }));

export const openSamplesDialog = (open = true) => useSamplesDialog.setState({ open });
