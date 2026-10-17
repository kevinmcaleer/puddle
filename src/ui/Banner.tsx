import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

const BANNER_ICON = { info: 'info', warn: 'alert', fail: 'cross' } as const;

export function Banner({ tone = 'info', title, children, action }: { tone?: 'info' | 'warn' | 'fail'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx('ui-banner', 'ui-banner--' + tone)} role={tone === 'fail' ? 'alert' : 'status'}>
      <Icon name={BANNER_ICON[tone]} />
      <div className="ui-banner__body ui-selectable">
        {title && <div className="ui-banner__title">{title}</div>}
        {children}
      </div>
      {action && <div className="ui-banner__action">{action}</div>}
    </div>
  );
}
