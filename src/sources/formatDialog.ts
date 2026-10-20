import { create } from 'zustand';

/** The Format picker: open over a source whose format the sniff couldn't settle, with what it saw. */
export const useFormatDialog = create<{ sourceId: string | null; reason?: string }>(() => ({ sourceId: null }));

export const openFormatDialog = (sourceId: string, reason?: string) => useFormatDialog.setState({ sourceId, reason });
export const closeFormatDialog = () => useFormatDialog.setState({ sourceId: null, reason: undefined });
