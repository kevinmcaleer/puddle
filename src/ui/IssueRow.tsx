import { Button } from './Button';
import { cx } from './cx';
import { abbreviate } from './format';
import { useDisplayFormat } from './locale';
import { StatusBadge, type Status } from './StatusBadge';

export type IssueRowSeverity = 'fix' | 'suggest' | 'info';

const BADGE: Record<IssueRowSeverity, { status: Status; word: string }> = {
  fix: { status: 'warn', word: 'Fix' },
  suggest: { status: 'neutral', word: 'Maybe' },
  info: { status: 'neutral', word: 'Note' },
};

/**
 * One issue analysis found in a node's data: what was found with how many rows it touches, a few values from the
 * data that show it, and the step that clears it. The badge carries a glyph and a word, never colour alone.
 */
export function IssueRow({
  name,
  severity,
  count,
  total,
  examples = [],
  fix,
  onIgnore,
}: {
  name: string;
  severity: IssueRowSeverity;
  /** Rows (or values) touched, shown as "12 of 44". */
  count: number;
  /** What the count is out of; left out, the count stands alone ("3 values"). */
  total?: number;
  /** Shown as data, in the mono font. */
  examples?: string[];
  /** The fix's name, e.g. "Trim whitespace"; none for an issue with nothing to apply. */
  fix?: string;
  onIgnore?: () => void;
}) {
  const display = useDisplayFormat();
  const badge = BADGE[severity];
  const metric = total != null ? `${abbreviate(count, display)} of ${abbreviate(total, display)}` : `${abbreviate(count, display)} ${count === 1 ? 'value' : 'values'}`;
  return (
    <div className={cx('ui-rule', severity !== 'fix' && 'text-ink-muted')} data-severity={severity}>
      <span className="ui-rule__sev">
        <StatusBadge status={badge.status}>{badge.word}</StatusBadge>
      </span>
      <span className="ui-rule__name" title={name}>{name}</span>
      <span className="ui-metric">{metric}</span>
      {examples.length > 0 && (
        <code className="ui-rule__expr" title={examples.join(' · ')}>
          {examples.map((e, i) => (
            <span key={i}>
              {i > 0 && <span className="text-ink-muted"> · </span>}
              <span>{JSON.stringify(e).slice(1, -1)}</span>
            </span>
          ))}
        </code>
      )}
      <div className="ui-rule__foot">
        <span className="text-label">{fix ? `Fix: ${fix}` : 'Nothing to apply'}</span>
        {onIgnore && (
          <Button size="sm" variant="ghost" icon="cross" onClick={onIgnore} aria-label={`Ignore issue: ${name}`}>
            Ignore
          </Button>
        )}
      </div>
    </div>
  );
}
