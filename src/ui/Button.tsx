import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

interface BaseButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'viewer';
  size?: 'md' | 'sm';
  icon?: IconName;
}

/** An icon-only button has no words to read out, so it must be given a name. */
export type ButtonProps = BaseButtonProps & ({ iconOnly?: false } | { iconOnly: true; 'aria-label': string });

export function Button({ variant = 'secondary', size = 'md', icon, iconOnly, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      className={cx('ui-btn', 'ui-btn--' + variant, size === 'sm' && 'ui-btn--sm', iconOnly && 'ui-btn--icon', className)}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
}
