import { useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export function Field({ label, hint, error, htmlFor, children }: { label?: string; hint?: ReactNode; error?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="ui-field">
      {label && <label className="ui-field__label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {(error || hint) && <div className={cx('ui-field__hint', !!error && 'is-error')}>{error || hint}</div>}
    </div>
  );
}

export function TextInput({ mono, error, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean; error?: boolean }) {
  return <input className={cx('ui-input', mono && 'is-mono', error && 'is-error', className)} {...rest} />;
}

export type SelectOption = string | { value: string; label: string };

export function Select({ options, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { options: SelectOption[] }) {
  return (
    <span className="ui-select-wrap">
      <select className={cx('ui-select', className)} {...rest}>
        {options.map((o) => (typeof o === 'string' ? <option key={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
      <Icon name="chevron-down" size={14} />
    </span>
  );
}

export function Switch({ checked, defaultChecked, onChange, label, id, 'aria-label': ariaLabel }: { checked?: boolean; defaultChecked?: boolean; onChange?: (on: boolean) => void; label?: string; id?: string; 'aria-label'?: string }) {
  const [own, setOwn] = useState(!!defaultChecked);
  const on = onChange ? !!checked : own;
  const toggle = () => (onChange ? onChange(!on) : setOwn(!on));
  const sw = <button type="button" role="switch" id={id} aria-checked={on} aria-label={label ? undefined : (ariaLabel ?? 'Toggle')} className="ui-switch" onClick={toggle} />;
  return label ? (
    <label className="ui-switch-row">
      {sw}
      <span>{label}</span>
    </label>
  ) : (
    sw
  );
}
