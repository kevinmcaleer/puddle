import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { abbreviate, formatBytes, formatDuration, fullCount } from './format';
import { Icon, type IconName } from './Icon';
import { Menu } from './Menu';
import { NODE_KIND, type NodeKind } from './nodeKinds';
import { StatusBadge, type Status } from './StatusBadge';

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

export function ResultsBar({
  title,
  kind = 'transform',
  pinned,
  children,
  onExport,
  exportLabel = 'Export',
  action,
}: {
  title: ReactNode;
  kind?: NodeKind;
  pinned?: boolean;
  children?: ReactNode;
  onExport?: () => void;
  exportLabel?: string;
  /** Replaces the plain Export button, e.g. with one that knows about the quality gate. */
  action?: ReactNode;
}) {
  return (
    <div className={cx('ui-resultsbar', pinned && 'is-pinned')}>
      <div className="ui-resultsbar__title">
        <Icon name={NODE_KIND[kind].icon} />
        <h2 className="min-w-0">{title}</h2>
        {pinned && (
          <span className="ui-pinned"><Icon name="pin" size={14} />Pinned</span>
        )}
        {action}
        {!action && onExport && (
          <Button size="sm" icon="export" variant={kind === 'output' ? 'primary' : 'secondary'} onClick={onExport}>{exportLabel}</Button>
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
  /** Memory used by every kept result, in bytes. */
  kept?: number;
  /** About the selected column, e.g. its profile. */
  detail?: ReactNode;
  /** Shown at the right-hand end, e.g. engine state. */
  end?: ReactNode;
  /** The open project's sync state, when it syncs; `syncTitle` says more on hover. */
  sync?: SyncState;
  syncTitle?: string;
}

export type SyncState = 'synced' | 'pending' | 'offline' | 'conflict' | 'error';

const SYNC_BADGE: Record<SyncState, { status: Status; text: string }> = {
  synced: { status: 'pass', text: 'Synced' },
  pending: { status: 'pending', text: 'Sync pending' },
  offline: { status: 'neutral', text: 'Offline' },
  conflict: { status: 'warn', text: 'Sync conflict' },
  error: { status: 'fail', text: 'Sync failed' },
};

export function StatusStrip({ rows, cols, ms, rules, sample, kept, detail, end, sync, syncTitle }: StatusStripProps) {
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
  if (detail) parts.push(<span key="detail">{detail}</span>);
  if (kept)
    parts.push(
      <span key="kept" data-testid="kept-total" title="Memory used by kept results">
        {formatBytes(kept)} kept
      </span>,
    );
  // The counts and rule results are a live region, so a screen reader hears them change; the end of the strip (the
  // running query's timer and Stop, the engine) isn't, or the timer would be read out four times a second.
  return (
    <footer className="ui-strip">
      <span role="status" className="ui-row" style={{ gap: 'var(--space-3)' }}>
        {parts.flatMap((p, i) => (i ? [<span key={`sep${i}`} className="ui-strip__sep" />, p] : [p]))}
      </span>
      <span className="ui-strip__end">
        {sync && (
          <span data-testid="sync-state" data-state={sync}>
            <StatusBadge status={SYNC_BADGE[sync].status} title={syncTitle}>
              {SYNC_BADGE[sync].text}
            </StatusBadge>
          </span>
        )}
        {end}
        {rows != null && (sample ? <StatusBadge status="warn">Sample of {abbreviate(sample)} rows</StatusBadge> : <span>Full data</span>)}
      </span>
    </footer>
  );
}
