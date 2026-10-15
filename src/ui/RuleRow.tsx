import { abbreviate } from './format';
import { StatusBadge } from './StatusBadge';

export function RuleRow({ name, expr, severity = 'fail', failures = 0, total, onShowFailing }: { name: string; expr?: string; severity?: 'warn' | 'fail'; failures?: number; total?: number; onShowFailing?: () => void }) {
  const ok = failures === 0;
  const status = ok ? 'pass' : severity;
  return (
    <div className="ui-rule">
      <span className="ui-rule__sev">
        <StatusBadge status={status}>{ok ? 'Pass' : severity === 'warn' ? 'Warn' : 'Fail'}</StatusBadge>
      </span>
      <span className="ui-rule__name">{name}</span>
      <span className="ui-metric">{ok ? `${abbreviate(total)} checked` : `${abbreviate(failures)} of ${abbreviate(total)}`}</span>
      {expr && <code className="ui-rule__expr">{expr}</code>}
      {!ok && (
        <div className="ui-rule__foot">
          <span />
          <button type="button" className="ui-link" onClick={onShowFailing}>Show failing rows</button>
        </div>
      )}
    </div>
  );
}
