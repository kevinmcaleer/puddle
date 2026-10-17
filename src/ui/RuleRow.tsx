import { Button } from './Button';
import { cx } from './cx';
import { abbreviate } from './format';
import { useDisplayFormat } from './locale';
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
  metric: metricText,
  noFailingRows,
  suggestion,
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
  /** Replaces the "n of total" figure, e.g. "12 rows" for a rule about the whole table. */
  metric?: string;
  /** Said in place of "Show failing rows" when the rule has no rows to show (a row count). */
  noFailingRows?: string;
  /**
   * A rule suggested from profiling, not yet added: shown muted with its reason and Add and Dismiss. It has no
   * result, because suggestions never run as rules.
   */
  suggestion?: { reason: string; onAdd: () => void; onDismiss: () => void };
}) {
  const display = useDisplayFormat();
  if (suggestion)
    return (
      <div className="ui-rule text-ink-muted" data-status="suggested">
        <span className="ui-rule__sev">
          <StatusBadge status="neutral">Suggested</StatusBadge>
        </span>
        <span className="ui-rule__name" title={name}>{name}</span>
        <span />
        <span className="col-[2/4] text-label">{suggestion.reason}</span>
        <span className="ui-rule__foot justify-end">
          <Button size="sm" variant="ghost" icon="plus" onClick={suggestion.onAdd} aria-label={`Add suggested rule: ${name}`}>Add</Button>
          <Button size="sm" variant="ghost" icon="cross" onClick={suggestion.onDismiss} aria-label={`Dismiss suggestion: ${name}`}>Dismiss</Button>
        </span>
      </div>
    );
  const ok = !error && failures === 0;
  const status = disabled ? 'neutral' : pending ? 'pending' : error ? 'fail' : ok ? 'pass' : severity;
  const word = disabled ? 'Off' : pending ? 'Checking' : error ? 'Can’t run' : ok ? 'Pass' : severity === 'warn' ? 'Warn' : 'Fail';
  const metric = disabled || pending ? '' : error ? '' : (metricText ?? (ok ? `${abbreviate(total, display)} checked` : `${abbreviate(failures, display)} of ${abbreviate(total, display)}`));
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
      {!ok && !error && !pending && !disabled && (noFailingRows || onShowFailing) && (
        <div className="ui-rule__foot">
          <span />
          {noFailingRows ? (
            <span className="text-label text-ink-muted">{noFailingRows}</span>
          ) : (
            <button type="button" className="ui-link" onClick={onShowFailing}>Show failing rows</button>
          )}
        </div>
      )}
    </div>
  );
}
