import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'viewer';
  size?: 'md' | 'sm';
  icon?: IconName;
  iconOnly?: boolean;
}

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
