import { cx } from './cx';
import { abbreviate } from './format';
import { StatusBadge } from './StatusBadge';

/**
 * One quality rule and its result. The name is the expectation ("No trailing spaces in name"); the badge
 * carries a glyph and a word, so the status never rests on colour.
 */
export function RuleRow({
  name,
  expr,
  severity = 'fail',
  failures = 0,
  total,
  pending,
  error,
  disabled,
  selected,
  onSelect,
  onShowFailing,
}: {
  name: string;
  expr?: string;
  severity?: 'warn' | 'fail';
  failures?: number;
  total?: number;
  pending?: boolean;
  error?: string;
  disabled?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  onShowFailing?: () => void;
}) {
  const ok = !error && failures === 0;
  const status = disabled ? 'neutral' : pending ? 'pending' : error ? 'fail' : ok ? 'pass' : severity;
  const word = disabled ? 'Off' : pending ? 'Checking' : error ? 'Can’t run' : ok ? 'Pass' : severity === 'warn' ? 'Warn' : 'Fail';
  const metric = disabled || pending ? '' : error ? '' : ok ? `${abbreviate(total)} checked` : `${abbreviate(failures)} of ${abbreviate(total)}`;
  return (
    <div className={cx('ui-rule', selected && 'bg-surface-hover')} data-status={status}>
      <span className="ui-rule__sev">
        <StatusBadge status={status}>{word}</StatusBadge>
      </span>
      {onSelect ? (
        <button type="button" className="ui-rule__name text-left" aria-pressed={!!selected} onClick={onSelect}>
          {name}
        </button>
      ) : (
        <span className="ui-rule__name">{name}</span>
      )}
      <span className="ui-metric">{metric}</span>
      {expr && <code className="ui-rule__expr">{expr}</code>}
      {error && <span className="ui-rule__expr text-fail" title={error}>{error}</span>}
      {!ok && !error && !pending && !disabled && onShowFailing && (
        <div className="ui-rule__foot">
          <span />
          <button type="button" className="ui-link" onClick={onShowFailing}>Show failing rows</button>
        </div>
      )}
    </div>
  );
}
