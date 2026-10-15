import { useState, type ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';

export interface StepListItem {
  label: ReactNode;
  disabled?: boolean;
  error?: string;
}

/**
 * The applied-steps list. Click or Enter selects; Alt+Up and Alt+Down or dragging reorders; Delete removes.
 */
export function StepList({
  steps,
  selected,
  viewed,
  onSelect,
  onAdd,
  onMove,
  onRemove,
}: {
  steps: StepListItem[];
  selected?: number;
  viewed?: number;
  onSelect?: (i: number) => void;
  onAdd?: (() => void) | false;
  onMove?: (from: number, to: number) => void;
  onRemove?: (i: number) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  return (
    <ol className="ui-steps" role="listbox" aria-label="Applied steps">
      {steps.map((s, i) => (
        <li
          key={i}
          role="option"
          aria-selected={i === selected}
          aria-disabled={s.disabled || undefined}
          tabIndex={0}
          draggable={!!onMove}
          className={cx('ui-step', i === selected && 'is-selected', s.disabled && 'is-off', s.error && 'has-error', dragging === i && 'opacity-50')}
          onClick={() => onSelect?.(i)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect?.(i);
            } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && onMove) {
              e.preventDefault();
              const to = e.key === 'ArrowUp' ? i - 1 : i + 1;
              if (to >= 0 && to < steps.length) {
                onMove(i, to);
                const list = e.currentTarget.parentElement;
                requestAnimationFrame(() => (list?.children[to] as HTMLElement | undefined)?.focus());
              }
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && onRemove) {
              // Keep the canvas from also deleting the selected node.
              e.preventDefault();
              e.stopPropagation();
              onRemove(i);
            }
          }}
          onDragStart={(e) => {
            setDragging(i);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => dragging != null && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dragging != null && dragging !== i) onMove?.(dragging, i);
            setDragging(null);
          }}
          onDragEnd={() => setDragging(null)}
          title={s.error}
        >
          <Icon name="grip" size={14} className="ui-step__grip" />
          <span className="ui-step__n">{i + 1}</span>
          <span className="ui-step__label">{s.label}</span>
          {s.error && <Icon name="alert" size={14} />}
          {i === viewed && (
            <span className="ui-step__eye" title="Viewing this step"><Icon name="eye" size={14} /></span>
          )}
        </li>
      ))}
      {onAdd !== false && (
        <li className="ui-steps__add">
          <Button variant="ghost" size="sm" icon="plus" onClick={onAdd || undefined}>Add step</Button>
        </li>
      )}
    </ol>
  );
}
