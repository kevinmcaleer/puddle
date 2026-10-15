import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export type Status = 'pass' | 'warn' | 'fail' | 'pending' | 'neutral';

const STATUS_ICON = { pass: 'tick', warn: 'alert', fail: 'cross' } as const;

/** Every status carries a glyph and a word, never colour alone. */
export function StatusBadge({ status = 'neutral', children, title }: { status?: Status; children?: ReactNode; title?: string }) {
  return (
    <span className={cx('ui-badge', 'ui-badge--' + status)} title={title}>
      {status === 'pass' || status === 'warn' || status === 'fail' ? (
        <Icon name={STATUS_ICON[status]} size={14} />
      ) : status === 'pending' ? (
        <span className="ui-dot" />
      ) : null}
      {children}
    </span>
  );
}
