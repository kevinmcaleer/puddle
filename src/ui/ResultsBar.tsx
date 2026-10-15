import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { abbreviate, formatDuration, fullCount } from './format';
import { Icon, type IconName } from './Icon';
import { Menu } from './Menu';
import { NODE_KIND, type NodeKind } from './nodeKinds';
import { StatusBadge } from './StatusBadge';

export interface QuickFix {
  label: string;
  icon?: IconName;
  /** Choices shown in a menu from the chip, e.g. the cases for Case. */
  options?: { id: string; label: string }[];
}

const MAX_CHIPS = 8;

/** At most eight chips; the rest wait behind More. A fix with options opens a menu of them. */
export function QuickFixBar({ fixes, onFix }: { fixes: Array<string | QuickFix>; onFix?: (fix: QuickFix, option?: string) => void }) {
  const all = fixes.map((f) => (typeof f === 'string' ? { label: f } : f));
  const shown = all.length > MAX_CHIPS ? all.slice(0, MAX_CHIPS - 1) : all;
  const more = all.slice(shown.length);
  const chip = (o: QuickFix, p?: { 'aria-haspopup': 'menu'; 'aria-expanded': boolean; onClick: () => void }) => (
    <button key={o.label} type="button" className="ui-chip" {...(p ?? { onClick: () => onFix?.(o) })}>
      {o.icon && <Icon name={o.icon} size={14} />}
      {o.label}
      {p && <Icon name="chevron-down" size={14} />}
    </button>
  );
  return (
    <div className="ui-quickfix" role="toolbar" aria-label="Quick fixes">
      <span className="ui-eyebrow" style={{ marginRight: 'var(--space-1)' }}>Quick fix</span>
      {shown.map((o) =>
        o.options ? (
          <Menu key={o.label} label={o.label} align="start" renderTrigger={(p) => chip(o, p)} items={o.options.map((opt) => ({ label: opt.label, onSelect: () => onFix?.(o, opt.id) }))} />
        ) : (
          chip(o)
        ),
      )}
      {more.length > 0 && (
        <Menu
          label="More"
          align="start"
          renderTrigger={(p) => chip({ label: 'More' }, p)}
          items={more.flatMap((o) => (o.options ? o.options.map((opt) => ({ label: `${o.label}: ${opt.label}`, onSelect: () => onFix?.(o, opt.id) })) : [{ label: o.label, onSelect: () => onFix?.(o) }]))}
        />
      )}
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
