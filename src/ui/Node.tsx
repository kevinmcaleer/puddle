import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { cx } from './cx';
import { abbreviate } from './format';
import { useDisplayFormat } from './locale';
import { Icon } from './Icon';
import { NODE_KIND, type NodeKind } from './nodeKinds';
import { StatusBadge, type Status } from './StatusBadge';

export interface NodeStepSummary {
  label: ReactNode;
  disabled?: boolean;
}

export interface NodeCardProps {
  kind?: NodeKind;
  name: string;
  detail?: string;
  rows?: number;
  cols?: number;
  steps?: number | NodeStepSummary[];
  rule?: { status: Status; label: string };
  /** Issues analysis found in the node's data, shown as a small badge. */
  issues?: number;
  selected?: boolean;
  viewed?: boolean;
  pinned?: boolean;
  /** Shown next to the pinned node in the results table. */
  comparing?: boolean;
  error?: string;
  dimmed?: boolean;
  expanded?: boolean;
  brokenInput?: boolean;
  /** A kept result's state, e.g. "5.1 MB kept" or "Kept · out of date", in the metric line. */
  kept?: { label: string; stale?: boolean };
  /** The node's note: a small marker in the header shows it on hover. */
  note?: string;
  style?: CSSProperties;
  className?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  /** Replace the decorative port spans, e.g. with React Flow handles. */
  renderPorts?: (ports: { inputs: string[]; output: boolean }) => ReactNode;
}

/** The node card. The canvas wraps this in a React Flow custom node and swaps the ports for handles. */
export function NodeCard({
  kind = 'transform', name, detail, rows, cols, steps, rule, issues, selected, viewed, pinned, comparing, error, dimmed, expanded, brokenInput, note, kept,
  style, className, onClick, renderPorts,
}: NodeCardProps) {
  const display = useDisplayFormat();
  const k = NODE_KIND[kind];
  const stepCount = Array.isArray(steps) ? steps.length : steps;
  const sub = detail ?? [k.label, stepCount != null && kind !== 'source' && `${stepCount} ${stepCount === 1 ? 'step' : 'steps'}`].filter(Boolean).join(' · ');
  const inputs = k.inputs === 2 ? ['33%', '67%'] : k.inputs ? ['50%'] : [];
  return (
    <div
      className={cx('ui-node', selected && 'is-selected', (viewed || comparing) && 'is-viewed', error && 'has-error', dimmed && 'is-dimmed', className)}
      data-kind={kind}
      style={style}
      onClick={onClick}
    >
      {renderPorts
        ? renderPorts({ inputs, output: !k.noOut })
        : inputs.map((top, i) => (
            <span key={i} className={cx('ui-port ui-port--in', brokenInput && 'is-broken')} style={{ top, marginTop: 'calc(var(--size-handle) / -2)' }} />
          ))}
      {(viewed || pinned || comparing) && (
        <span className="ui-node__eye" data-testid="node-pill">
          <Icon name={pinned ? 'pin' : comparing ? 'compare' : 'eye'} size={12} />
          {pinned ? 'Pinned' : comparing ? 'Comparing' : 'Viewing'}
        </span>
      )}
      <div className="ui-node__head">
        <span className="ui-node__chip"><Icon name={k.icon} /></span>
        <div className="ui-node__titles">
          <div className="ui-node__name" title={name}>{name}</div>
          <div className="ui-node__kind">{sub}</div>
        </div>
        {note && (
          <span className="flex-none self-start text-ink-muted" title={note} aria-label={`Note: ${note}`} role="img" data-testid="node-note">
            <Icon name="notes" size={14} />
          </span>
        )}
      </div>
      {error && (
        <div className="ui-node__error">
          <Icon name="cross" size={14} />
          <span>{error}</span>
        </div>
      )}
      {(rows != null || rule || kept || issues) && (
        <div className="ui-node__meta">
          <span className="ui-metric">
            {rows != null && `${abbreviate(rows, display)} rows`}
            {cols != null && ` · ${cols} cols`}
            {kept && (
              <span data-testid="node-kept" data-stale={kept.stale ? 'true' : undefined}>
                {(rows != null || cols != null) && ' · '}
                {kept.label}
              </span>
            )}
          </span>
          <span className="ui-row" style={{ gap: 4 }}>
            {issues ? <span data-testid="node-issues"><StatusBadge status="warn">{issues} {issues === 1 ? 'issue' : 'issues'}</StatusBadge></span> : null}
            {rule && <StatusBadge status={rule.status}>{rule.label}</StatusBadge>}
          </span>
        </div>
      )}
      {expanded && Array.isArray(steps) && (
        <ol className="ui-node__steps">
          {steps.map((s, i) => (
            <li key={i} className={s.disabled ? 'is-off' : undefined}>{s.label}</li>
          ))}
        </ol>
      )}
      {!renderPorts && !k.noOut && <span className="ui-port ui-port--out" />}
    </div>
  );
}
