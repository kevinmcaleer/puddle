import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cx } from '../../ui';
import type { DbmlSchema } from '../model';
import type { SchemaError } from '../parse';
import { completions, type CompletionContext } from './completion';
import { highlightDbml, matchingBracket, type SpanKind } from './highlight';

/** The editor's line height and character width, as its CSS sets them (12px/18px JetBrains Mono, 0.6em advance). */
const LINE = 18;
const CHAR = 7.2;
const INDENT = '  ';

export interface DbmlEditorHandle {
  /** Select a range and scroll it into view, as when a table is picked in the diagram. */
  select: (start: number, end: number) => void;
  /** Put the caret at an offset and focus the editor, as when an error is picked. */
  focusAt: (offset: number) => void;
}

interface Segment {
  text: string;
  kind?: SpanKind;
  error?: boolean;
  match?: boolean;
}

/** The text cut at every highlight, error and bracket boundary, each piece with what applies to it. */
function segments(text: string, errors: SchemaError[], match: [number, number] | undefined): Segment[] {
  const spans = highlightDbml(text);
  const cuts = new Set<number>([0, text.length]);
  for (const s of spans) cuts.add(s.start).add(s.end);
  // An error with no width still marks the character it points at.
  const errorRanges = errors.map((e) => [Math.min(e.start, text.length), Math.min(Math.max(e.end, e.start + 1), text.length)] as const);
  for (const [a, b] of errorRanges) cuts.add(a).add(b);
  if (match) for (const m of match) cuts.add(m).add(m + 1);
  const points = [...cuts].filter((c) => c >= 0 && c <= text.length).sort((a, b) => a - b);
  const out: Segment[] = [];
  let si = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i]!, points[i + 1]!];
    if (a === b) continue;
    while (si < spans.length && spans[si]!.end <= a) si++;
    const span = spans[si] && spans[si]!.start <= a && spans[si]!.end >= b ? spans[si] : undefined;
    out.push({ text: text.slice(a, b), kind: span?.kind, error: errorRanges.some(([x, y]) => x <= a && y >= b), match: !!match && (match[0] === a || match[1] === a) });
  }
  return out;
}

/** The line and column (0-based) of an offset. */
function lineCol(text: string, offset: number) {
  const before = text.slice(0, offset);
  const line = before.split('\n').length - 1;
  return { line, col: offset - (before.lastIndexOf('\n') + 1) };
}

/**
 * Replace a range of the textarea's text the way typing would, so the browser's own undo (Ctrl+Z while editing)
 * takes it back; where that isn't available, set the text and announce the change.
 */
function insert(el: HTMLTextAreaElement, start: number, end: number, text: string, caret = start + text.length) {
  el.focus();
  el.setSelectionRange(start, end);
  const done = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
  if (!done) {
    el.setRangeText(text, start, end, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.setSelectionRange(caret, caret);
}

export interface DbmlEditorProps {
  value: string;
  schema: DbmlSchema;
  errors: SchemaError[];
  placeholder?: string;
  onChange: (text: string) => void;
  /** The caret moved, to this offset. */
  onCaret?: (offset: number) => void;
  /** Typing paused or the editor lost focus: a moment to close the undo step. */
  onSettle?: () => void;
}

/**
 * The DBML editor: coloured text, mistakes underlined, matching brackets marked, suggestions as you type (Tab takes
 * one; Enter does once the arrow keys or Ctrl+Space chose it), auto-indent, and Ctrl+/ to comment lines.
 */
export const DbmlEditor = forwardRef<DbmlEditorHandle, DbmlEditorProps>(function DbmlEditor({ value, schema, errors, placeholder, onChange, onCaret, onSettle }, ref) {
  const area = useRef<HTMLTextAreaElement>(null);
  const under = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [suggest, setSuggest] = useState<CompletionContext | null>(null);
  const [active, setActive] = useState(0);
  /** Enter takes a suggestion only once one was chosen with the arrow keys; Tab always does. */
  const [chosen, setChosen] = useState(false);
  const settleTimer = useRef<number | undefined>(undefined);

  useImperativeHandle(ref, () => ({
    select: (start, end) => {
      const el = area.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(start, end);
      const { line } = lineCol(el.value, start);
      el.scrollTop = Math.max(0, line * LINE - el.clientHeight / 3);
      setCaret(start);
    },
    focusAt: (offset) => {
      const el = area.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(offset, offset);
      const { line } = lineCol(el.value, offset);
      el.scrollTop = Math.max(0, line * LINE - el.clientHeight / 3);
      setCaret(offset);
      onCaret?.(offset);
    },
  }));

  const match = useMemo(() => matchingBracket(value, caret), [value, caret]);
  const pieces = useMemo(() => segments(value, errors, match), [value, errors, match]);
  const lines = value.split('\n').length;
  const errorLines = useMemo(() => new Set(errors.map((e) => e.line)), [errors]);

  // Keep the coloured copy and the line numbers scrolled with the text.
  useLayoutEffect(() => {
    if (under.current) {
      under.current.scrollTop = scroll.top;
      under.current.scrollLeft = scroll.left;
    }
    if (gutter.current) gutter.current.scrollTop = scroll.top;
  });

  const settleSoon = () => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => onSettle?.(), 800);
  };

  const moved = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart);
    onCaret?.(el.selectionStart);
  };

  const items = suggest?.items ?? [];
  const pick = (i: number) => {
    const el = area.current;
    const ctx = suggest;
    const item = ctx?.items[i];
    if (!el || !ctx || !item) return;
    setSuggest(null);
    insert(el, ctx.start, el.selectionStart, item.insert);
  };

  const keyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (items.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
        setChosen(true);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && chosen)) {
        e.preventDefault();
        pick(active);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSuggest(null);
        return;
      }
    }
    const { selectionStart: start, selectionEnd: end } = el;
    const text = el.value;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const indent = /^[ \t]*/.exec(text.slice(lineStart))![0];
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      // Keep the line's indent, one more after an opening brace, and put a closing brace that follows on its own line.
      e.preventDefault();
      const opens = /[{[]\s*$/.test(text.slice(lineStart, start));
      const closes = /^\s*[}\]]/.test(text.slice(end));
      const inner = indent + (opens ? INDENT : '');
      if (opens && closes) insert(el, start, end, `\n${inner}\n${indent}`, start + 1 + inner.length);
      else insert(el, start, end, `\n${inner}`);
      return;
    }
    if (e.key === '}' && start === end && /^[ \t]+$/.test(text.slice(lineStart, start)) && indent.length >= INDENT.length) {
      e.preventDefault();
      insert(el, lineStart, start, indent.slice(INDENT.length) + '}');
      return;
    }
    if (e.key === '/' && (e.ctrlKey || e.metaKey)) {
      // Comment or uncomment the selected lines.
      e.preventDefault();
      const blockEnd = text.indexOf('\n', Math.max(start, end - (end > start && text[end - 1] === '\n' ? 1 : 0)));
      const stop = blockEnd < 0 ? text.length : blockEnd;
      const block = text.slice(lineStart, stop).split('\n');
      const commented = block.every((l) => !l.trim() || /^\s*\/\//.test(l));
      const next = block.map((l) => (!l.trim() ? l : commented ? l.replace(/^(\s*)\/\/ ?/, '$1') : l.replace(/^(\s*)/, '$1// '))).join('\n');
      insert(el, lineStart, stop, next, lineStart + next.length);
      el.setSelectionRange(lineStart, lineStart + next.length);
      return;
    }
    if (e.key === ' ' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const ctx = completions(text, start, schema);
      setSuggest(ctx.items.length ? ctx : null);
      setActive(0);
      setChosen(true);
    }
  };

  const pos = lineCol(value, suggest?.start ?? caret);
  const listId = 'dbml-suggestions';

  return (
    <div className="puddle-dbml">
      <div ref={gutter} className="puddle-dbml__gutter" aria-hidden>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className={cx('puddle-dbml__lineno', errorLines.has(i + 1) && 'is-error')}>
            {i + 1}
          </div>
        ))}
      </div>
      <div className="puddle-dbml__body">
        <pre ref={under} className="puddle-dbml__under" aria-hidden>
          {pieces.map((p, i) => (
            <span key={i} className={cx(p.kind && `dbml-${p.kind}`, p.error && 'dbml-error', p.match && 'dbml-match')}>
              {p.text}
            </span>
          ))}
          {'\n'}
        </pre>
        <textarea
          ref={area}
          className="puddle-dbml__text"
          aria-label="DBML"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          wrap="off"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items.length ? `${listId}-${active}` : undefined}
          aria-invalid={errors.length > 0}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            const el = e.currentTarget;
            onChange(el.value);
            moved(el);
            settleSoon();
            const ctx = completions(el.value, el.selectionStart, schema);
            const typedWord = ctx.word.length > 0 && el.selectionStart === el.selectionEnd;
            setSuggest(typedWord && ctx.items.length ? ctx : null);
            setActive(0);
            setChosen(false);
          }}
          onSelect={(e) => moved(e.currentTarget)}
          onKeyDown={keyDown}
          onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}
          onBlur={() => {
            setSuggest(null);
            window.clearTimeout(settleTimer.current);
            onSettle?.();
          }}
        />
        {items.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Suggestions"
            className="ui-popover puddle-dbml__suggest"
            style={{ top: (pos.line + 1) * LINE - scroll.top + 6, left: Math.max(0, pos.col * CHAR - scroll.left) }}
          >
            {items.map((item, i) => (
              <li
                key={`${item.kind}:${item.label}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cx('puddle-dbml__option', i === active && 'is-active')}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
              >
                <span className="ui-col">{item.label}</span>
                <span className="ui-metric">{item.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});
