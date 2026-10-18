import { useState, type ReactNode } from 'react';

export function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className="ui-section" aria-label={title}>
      <div className="ui-section__head">
        <div className="ui-section__title">
          <h2 className="ui-eyebrow">{title}</h2>
          {count != null && <span className="ui-metric">{count}</span>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  disabled?: boolean;
  /** Says why, when it's disabled. */
  title?: string;
}

export function Tabs({ items, value, onChange, label }: { items: TabItem[]; value?: string; onChange?: (id: string) => void; label?: string }) {
  const [own, setOwn] = useState(value ?? items[0]?.id);
  const current = onChange ? value : own;
  return (
    <div className="ui-tabs" role="tablist" aria-label={label}>
      {items.map((t) => (
        <button key={t.id} type="button" role="tab" className="ui-tab" aria-selected={t.id === current} disabled={t.disabled} title={t.title} onClick={() => (onChange ? onChange(t.id) : setOwn(t.id))}>
          {t.label}
          {t.count != null && <span className="ui-tab__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
