import { useLayoutEffect, useRef, useState } from 'react';
import type { ColumnSchema } from '../model';
import { columnKind, cx, TypeTag } from '../ui';
import { insertColumn, suggest, wordAt } from './expression';

/**
 * A DuckDB SQL expression editor: monospace, commits on blur or Ctrl+Enter, and suggests the step's columns
 * as you type (Arrow keys to choose, Tab or Enter to insert). Shared with custom quality rules.
 */
export function ExpressionInput({
  id,
  value,
  columns,
  error,
  rows = 2,
  placeholder,
  'aria-label': ariaLabel,
  onCommit,
}: {
  id: string;
  value: string;
  columns: ColumnSchema[];
  error?: boolean;
  /** Lines shown before it scrolls; a whole query wants more than an expression. */
  rows?: number;
  placeholder?: string;
  /** For an editor with no visible label of its own. */
  'aria-label'?: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Where to put the caret after inserting a column. Set before the next keystroke can land, not a frame later.
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaret.current == null) return;
    ref.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });
  const matches = open ? suggest(columns, wordAt(draft, caret).word) : [];

  const pick = (column: string) => {
    const next = insertColumn(draft, caret, column);
    setDraft(next.text);
    setCaret(next.caret);
    setOpen(false);
    pendingCaret.current = next.caret;
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls={`${id}-columns`}
        aria-autocomplete="list"
        className={cx('ui-input is-mono h-auto resize-y py-1', error && 'is-error')}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setCaret(e.target.selectionStart);
          setOpen(true);
          setActive(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onBlur={() => {
          setOpen(false);
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if (e.key === 'Tab' || e.key === 'Enter') {
              e.preventDefault();
              pick(matches[active]!.name);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
              return;
            }
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (draft !== value) onCommit(draft);
          }
        }}
      />
      {matches.length > 0 && (
        <ul id={`${id}-columns`} role="listbox" aria-label="Columns" className="ui-popover absolute left-0 right-0 top-full z-popover mt-1 py-1">
          {matches.map((c, i) => (
            <li
              key={c.name}
              role="option"
              aria-label={c.name}
              aria-selected={i === active}
              className={cx('flex cursor-pointer items-center gap-2 px-2 py-1', i === active && 'bg-surface-hover')}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c.name);
              }}
            >
              <TypeTag type={columnKind(c.type)} decorative />
              <span className="ui-col">{c.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
