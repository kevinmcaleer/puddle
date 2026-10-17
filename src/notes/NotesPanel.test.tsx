// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSession } from '../app/session';
import { createProject, useProjectStore } from '../model';
import { NotesPanel } from './NotesPanel';

const state = () => useProjectStore.getState().history;
const box = () => screen.getByLabelText<HTMLTextAreaElement>('Project notes');
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

describe('NotesPanel', () => {
  beforeEach(() => useProjectStore.getState().load(createProject('Notes')));
  afterEach(cleanup);

  it('saves notes as they are typed, as one undo step per editing session', () => {
    render(<NotesPanel />);
    act(() => box().focus());
    for (const text of ['#', '# Pl', '# Plan']) type(text);
    // Saved as typed, so autosave has them, but not yet an undo step.
    expect(state().present.notes).toBe('# Plan');
    expect(state().past).toHaveLength(0);
    act(() => box().blur());
    expect(state().past).toHaveLength(1);

    act(() => box().focus());
    type('# Plan\n\nMore');
    act(() => box().blur());
    expect(state().past).toHaveLength(2);

    act(() => useProjectStore.getState().undo());
    expect(box().value).toBe('# Plan');
    act(() => useProjectStore.getState().undo());
    expect(box().value).toBe('');
  });

  it('adds no undo step when a session changes nothing', () => {
    render(<NotesPanel />);
    act(() => box().focus());
    act(() => box().blur());
    expect(state().past).toHaveLength(0);
  });

  it('closing the panel mid-edit still ends the session', () => {
    const { unmount } = render(<NotesPanel />);
    act(() => box().focus());
    type('half written');
    unmount();
    expect(state().past).toHaveLength(1);
    expect(state().present.notes).toBe('half written');
  });

  it('previews Markdown with script and HTML as text and links in a new tab', () => {
    useProjectStore.getState().load({ ...createProject('Notes'), notes: '# Title\n\n<script>window.hacked = true</script>\n\n<img src=x onerror="window.hacked = true">\n\n[DuckDB](https://duckdb.org)' });
    render(<NotesPanel />);
    // Notes that exist open in the rendered view.
    const preview = screen.getByTestId('notes-preview');
    expect(preview.querySelector('h1')?.textContent).toBe('Title');
    expect(preview.querySelectorAll('script, img')).toHaveLength(0);
    expect(preview.textContent).toContain('<script>window.hacked = true</script>');
    expect(preview.textContent).toContain('<img src=x onerror="window.hacked = true">');
    const link = screen.getByRole('link', { name: 'DuckDB' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();

    fireEvent.click(screen.getByRole('tab', { name: 'Write' }));
    expect(box().value).toContain('<script>');
  });

  it('opening the notes shows the inspector dock, and selecting a node moves to its tab', () => {
    useSession.setState({ inspectorOpen: false });
    useSession.getState().setInspectorTab('notes');
    expect(useSession.getState().inspectorOpen).toBe(true);
    useSession.getState().select(null);
    expect(useSession.getState().inspectorTab).toBe('notes');
    useSession.getState().select('n1');
    expect(useSession.getState().inspectorTab).toBe('node');
  });
});
