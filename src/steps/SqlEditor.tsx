import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { sql } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, Prec, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, keymap, placeholder as placeholderText, tooltips, type DecorationSet } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import type { ColumnSchema } from '../model';
import { cx } from '../ui';
import { UNDO_ATTRIBUTE } from '../ui/undo';
import { markedPieces, type TextMark } from './marks';
import { keywordCase, upperKeywords } from './sqlKeywords';

/** SQL's parts in the design system's colours. */
const HIGHLIGHT = HighlightStyle.define([
  { tag: tags.keyword, class: 'sql-keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'sql-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'sql-number' },
  { tag: tags.comment, class: 'sql-comment' },
  { tag: tags.typeName, class: 'sql-type' },
]);

/** Asks the marks to be worked out again: the tables on the canvas changed, or what is pointed at did. */
const refreshMarks = StateEffect.define<null>();

interface Latest {
  value: string;
  columns: ColumnSchema[];
  onCommit: (v: string) => void;
  onSubmit?: (v: string) => void;
  marks?: (text: string) => TextMark[];
  onPoint?: (mark: TextMark | undefined) => void;
}

const sameMark = (a: TextMark | undefined, b: TextMark | undefined) => a?.start === b?.start && a?.end === b?.end && a?.nodeId === b?.nodeId;

/**
 * The editor for a whole SQL query or script (CodeMirror): keywords coloured, and written in capitals as each is
 * finished; the query's tables marked as found or not (see `marks`); the tables' columns suggested as you type.
 * Like the other editors it commits on blur or Ctrl+Enter, with every keyword in capitals.
 */
export function SqlEditor({
  id,
  value,
  columns,
  error,
  rows = 2,
  placeholder,
  'aria-label': ariaLabel,
  onCommit,
  onSubmit,
  marks,
  onPoint,
}: {
  id: string;
  value: string;
  columns: ColumnSchema[];
  error?: boolean;
  /** Lines shown before it scrolls. */
  rows?: number;
  placeholder?: string;
  'aria-label'?: string;
  onCommit: (v: string) => void;
  /** Ctrl+Enter was pressed, after anything changed was committed: the text as it stands, changed or not. */
  onSubmit?: (v: string) => void;
  /** The marks for the text as it is being typed, such as the tables a query names. */
  marks?: (text: string) => TextMark[];
  /** The mark under the pointer, else the one the caret is in while the editor has focus; undefined when neither. */
  onPoint?: (mark: TextMark | undefined) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef<Latest>({ value, columns, onCommit, onSubmit, marks, onPoint });
  const pointed = useRef<{ hovered?: TextMark; told?: TextMark }>({});
  useEffect(() => {
    latest.current = { value, columns, onCommit, onSubmit, marks, onPoint };
  });

  useEffect(() => {
    const marksOf = (text: string) => (latest.current.marks ? markedPieces(text, latest.current.marks(text)).flatMap((p) => (p.mark ? [p.mark] : [])) : []);
    /** The mark pointed at: the one under the pointer, else the one the caret is in while the editor has focus. */
    const pointedAt = (v: EditorView): TextMark | undefined => {
      if (pointed.current.hovered) return pointed.current.hovered;
      if (!v.hasFocus) return undefined;
      const head = v.state.selection.main.head;
      return marksOf(v.state.doc.toString()).find((m) => m.start <= head && head <= m.end);
    };
    const tell = (v: EditorView) => {
      const now = pointedAt(v);
      if (sameMark(now, pointed.current.told)) return;
      pointed.current.told = now;
      latest.current.onPoint?.(now);
      v.dispatch({ effects: refreshMarks.of(null) });
    };
    const decorate = (state: EditorState): DecorationSet => {
      const told = pointed.current.told;
      return Decoration.set(
        marksOf(state.doc.toString()).map((m, i) =>
          Decoration.mark({
            class: cx(m.found ? 'sql-table-found' : 'sql-table-missing', sameMark(m, told) && 'is-pointed'),
            attributes: { 'data-mark': String(i), 'data-found': String(m.found) },
          }).range(m.start, m.end),
        ),
      );
    };
    const tableMarks = StateField.define<DecorationSet>({
      create: decorate,
      update: (set, tr) => (tr.docChanged || tr.effects.some((e) => e.is(refreshMarks)) ? decorate(tr.state) : set),
      provide: (f) => EditorView.decorations.from(f),
    });

    const commit = (v: EditorView) => {
      const text = upperKeywords(v.state.doc.toString());
      if (text !== v.state.doc.toString()) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, annotations: Transaction.addToHistory.of(false) });
      if (text !== latest.current.value) latest.current.onCommit(text);
      return text;
    };

    const suggestColumns = (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(/[\w$]+/);
      if (!word || (word.from === word.to && !context.explicit)) return null;
      return {
        from: word.from,
        options: latest.current.columns.map((c) => ({ label: c.name, type: 'property', detail: c.type, apply: /^[A-Za-z_][\w$]*$/.test(c.name) ? c.name : `"${c.name.replace(/"/g, '""')}"` })),
        validFor: /^[\w$]*$/,
      };
    };
    const language = sql({ upperCaseKeywords: true });

    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          history(),
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-Enter',
                run: (v) => {
                  // Committed first, whether or not anyone asked to hear of the key.
                  const text = commit(v);
                  latest.current.onSubmit?.(text);
                  return true;
                },
              },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          language,
          language.language.data.of({ autocomplete: suggestColumns }),
          // Nothing is picked until an arrow key picks it, so Enter at the end of a line is always a new line.
          autocompletion({ icons: false, selectOnOpen: false }),
          // The suggestions are drawn over the page: the editor clips what runs past its own box.
          tooltips({ position: 'fixed' }),
          syntaxHighlighting(HIGHLIGHT),
          EditorView.lineWrapping,
          EditorState.tabSize.of(2),
          tableMarks,
          ...(placeholder ? [placeholderText(placeholder)] : []),
          EditorView.contentAttributes.of((v) => ({
            id,
            'data-testid': `${id}-marks`,
            'aria-multiline': 'true',
            spellcheck: 'false',
            ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
            // Undo goes to the app while the editor holds what is saved (see src/ui/undo.ts).
            ...(v.state.doc.toString() === latest.current.value ? { [UNDO_ATTRIBUTE]: '' } : {}),
          })),
          // A keyword is written in capitals once it is finished: the caret has moved on from it.
          EditorView.updateListener.of((update) => {
            if (update.docChanged && update.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete'))) {
              const changes = keywordCase(update.state.doc.toString(), update.state.selection.main.head);
              if (changes.length) update.view.dispatch({ changes, annotations: Transaction.addToHistory.of(false) });
            }
            if (update.selectionSet || update.focusChanged || update.docChanged) tell(update.view);
          }),
          EditorView.domEventHandlers({
            blur: (_e, v) => {
              commit(v);
            },
            mousemove: (e, v) => {
              const span = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-mark]') : null;
              pointed.current.hovered = span ? marksOf(v.state.doc.toString())[Number(span.dataset.mark)] : undefined;
              tell(v);
            },
            mouseleave: (_e, v) => {
              pointed.current.hovered = undefined;
              tell(v);
            },
          }),
        ],
      }),
    });
    view.current = editor;
    const told = pointed.current;
    const callbacks = latest;
    return () => {
      // Nothing stays pointed at once the editor has gone.
      if (told.told) callbacks.current.onPoint?.(undefined);
      editor.destroy();
      view.current = null;
    };
    // The editor is built once; what changes later reaches it through `latest` and the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What is saved changed from outside (undo, another view): show it, unless it is what the editor already holds.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, annotations: Transaction.addToHistory.of(false) });
  }, [value]);

  // The tables on the canvas changed: mark the query's names again.
  useEffect(() => {
    view.current?.dispatch({ effects: refreshMarks.of(null) });
  }, [marks]);

  return <div ref={host} className={cx('ui-input is-mono puddle-cm', error && 'is-error')} style={{ height: `calc(${rows} * var(--cm-line) + 2 * var(--space-1) + 2px)` }} />;
}
