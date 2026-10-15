import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';

export interface StepListItem {
  label: ReactNode;
  disabled?: boolean;
  error?: string;
}

export function StepList({ steps, selected, viewed, onSelect, onAdd }: { steps: StepListItem[]; selected?: number; viewed?: number; onSelect?: (i: number) => void; onAdd?: (() => void) | false }) {
  return (
    <ol className="ui-steps" role="listbox" aria-label="Applied steps">
      {steps.map((s, i) => (
        <li
          key={i}
          role="option"
          aria-selected={i === selected}
          tabIndex={0}
          className={cx('ui-step', i === selected && 'is-selected', s.disabled && 'is-off', s.error && 'has-error')}
          onClick={() => onSelect?.(i)}
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
