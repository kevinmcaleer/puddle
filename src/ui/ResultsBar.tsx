import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { abbreviate, formatDuration, fullCount } from './format';
import { Icon, type IconName } from './Icon';
import { NODE_KIND, type NodeKind } from './nodeKinds';
import { StatusBadge } from './StatusBadge';

export interface QuickFix {
  label: string;
  icon?: IconName;
}

export function QuickFixBar({ fixes, onFix }: { fixes: Array<string | QuickFix>; onFix?: (fix: QuickFix) => void }) {
  return (
    <div className="ui-quickfix" role="toolbar" aria-label="Quick fixes">
      <span className="ui-eyebrow" style={{ marginRight: 'var(--space-1)' }}>Quick fix</span>
      {fixes.map((f) => {
        const o = typeof f === 'string' ? { label: f } : f;
        return (
          <button key={o.label} type="button" className="ui-chip" onClick={() => onFix?.(o)}>
            {o.icon && <Icon name={o.icon} size={14} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ResultsBar({ title, kind = 'transform', pinned, children, onExport }: { title: ReactNode; kind?: NodeKind; pinned?: boolean; children?: ReactNode; onExport?: () => void }) {
  return (
    <div className={cx('ui-resultsbar', pinned && 'is-pinned')}>
      <div className="ui-resultsbar__title">
        <Icon name={NODE_KIND[kind].icon} />
        <span>{title}</span>
        {pinned && (
          <span className="ui-pinned"><Icon name="pin" size={14} />Pinned</span>
        )}
        {onExport && (
          <Button size="sm" icon="export" variant={kind === 'output' ? 'primary' : 'secondary'} onClick={onExport}>Export</Button>
        )}
      </div>
      {children}
    </div>
  );
}

export interface StatusStripProps {
  rows?: number;
  cols?: number;
  ms?: number;
  rules?: { pass: number; warn: number; fail: number };
  sample?: number;
  /** Shown at the right-hand end, e.g. engine state. */
  end?: ReactNode;
}

export function StatusStrip({ rows, cols, ms, rules, sample, end }: StatusStripProps) {
  const parts: ReactNode[] = [];
  if (rows != null) parts.push(<span key="rows">{fullCount(rows)} rows</span>);
  if (cols != null) parts.push(<span key="cols">{cols} cols</span>);
  if (ms != null) parts.push(<span key="ms">{formatDuration(ms)}</span>);
  if (rules)
    parts.push(
      <span key="rules" className="ui-row" style={{ gap: 6 }}>
        <StatusBadge status="pass">{rules.pass} pass</StatusBadge>
        {rules.warn > 0 && <StatusBadge status="warn">{rules.warn} warn</StatusBadge>}
        <StatusBadge status={rules.fail ? 'fail' : 'neutral'}>{rules.fail} fail</StatusBadge>
      </span>,
    );
  return (
    <div className="ui-strip" role="status">
      {parts.flatMap((p, i) => (i ? [<span key={`sep${i}`} className="ui-strip__sep" />, p] : [p]))}
      <span className="ui-strip__end">
        {end}
        {rows != null && (sample ? <StatusBadge status="warn">Sample of {abbreviate(sample)} rows</StatusBadge> : <span>Full data</span>)}
      </span>
    </div>
  );
}
