import { create } from 'zustand';

/**
 * Whether each source's data is available in this tab. Projects store references, not data (plan D6), so a
 * reopened project's file sources start detached until the file is chosen again.
 * - attached: registered with DuckDB;
 * - detached: the file needs choosing again;
 * - mismatch: a file was chosen, but its first megabyte differs from the one the project was built on.
 */
export type Attachment = 'attached' | 'detached' | 'mismatch';

interface AttachmentState {
  sources: Record<string, Attachment>;
}

export const useAttachments = create<AttachmentState>(() => ({ sources: {} }));

export const attachmentOf = (sourceId: string): Attachment => useAttachments.getState().sources[sourceId] ?? 'detached';

export const markAttached = (sourceId: string, state: Attachment = 'attached') =>
  useAttachments.setState((s) => ({ sources: { ...s.sources, [sourceId]: state } }));

/** True when a source can't be read in this tab. */
export const isDetached = (sourceId: string) => attachmentOf(sourceId) === 'detached';
