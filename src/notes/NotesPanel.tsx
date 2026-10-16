import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../app/session';
import { useProject, useProjectStore, type Project } from '../model';
import { Button, Tabs } from '../ui';
import { renderMarkdown } from './markdown';
import './notes.css';

const TABS = [
  { id: 'write', label: 'Write' },
  { id: 'preview', label: 'Preview' },
];

/**
 * Keeps the project's notes as they are typed (so autosave has them) while making each editing session, from
 * focus to blur, a single undo step.
 */
function useNotesSession() {
  const before = useRef<Project | null>(null);
  const close = () => {
    const start = before.current;
    before.current = null;
    const { history, checkpoint } = useProjectStore.getState();
    if (start && start.notes !== history.present.notes) checkpoint(start);
  };
  // Closing the panel mid-edit still ends the session.
  useEffect(() => close, []);
  return {
    open: () => {
      before.current ??= useProjectStore.getState().history.present;
    },
    change: (notes: string) => {
      before.current ??= useProjectStore.getState().history.present;
      useProjectStore.getState().amend((p) => (p.notes === notes ? p : { ...p, notes }));
    },
    close,
  };
}

/** The project's notes: Markdown written in one tab and read, rendered, in the other. */
export function NotesPanel() {
  const notes = useProject().notes;
  const [tab, setTab] = useState(notes ? 'preview' : 'write');
  const session = useNotesSession();
  const html = useMemo(() => (tab === 'preview' ? renderMarkdown(notes) : ''), [tab, notes]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="notes-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-body-strong text-ink">Project notes</h2>
        <Tabs label="Notes view" items={TABS} value={tab} onChange={setTab} />
        <Button variant="ghost" size="sm" icon="cross" iconOnly aria-label="Close notes" onClick={() => useSession.getState().setNotesOpen(false)} />
      </div>
      {tab === 'write' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
          <textarea
            aria-label="Project notes"
            className="ui-input min-h-0 w-full flex-1 resize-none py-2 font-mono text-code"
            value={notes}
            placeholder="What this project is for, where its files come from, what to check before sharing."
            onFocus={session.open}
            onChange={(e) => session.change(e.target.value)}
            onBlur={session.close}
          />
          <p className="text-label text-ink-muted">Markdown: # headings, **bold**, *italic*, - lists, [links](https://example.com), `code`.</p>
        </div>
      ) : notes.trim() ? (
        // Safe to inject: renderMarkdown escapes all HTML and keeps only safe links (see markdown.ts).
        <div className="puddle-notes min-h-0 flex-1 overflow-auto p-4" data-testid="notes-preview" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="p-4 text-ink-muted" data-testid="notes-preview">No notes yet. Write some in the Write tab.</p>
      )}
    </div>
  );
}
