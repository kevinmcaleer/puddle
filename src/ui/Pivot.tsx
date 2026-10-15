import { Children, type ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import { TypeTag, type ColumnKind } from './TypeTag';

export function FieldChip({ name, type, agg, onRemove }: { name: string; type?: ColumnKind; agg?: string; onRemove?: (() => void) | false }) {
  return (
    <div className="ui-fchip" draggable>
      <Icon name="grip" size={14} className="ui-fchip__grip" />
      <TypeTag type={type} />
      <span className="ui-fchip__name">{name}</span>
      {agg && <span className="ui-fchip__agg">{agg}</span>}
      {onRemove !== false && (
        <button type="button" className="ui-fchip__x" aria-label={`Remove ${name}`} onClick={onRemove || undefined}>
          <Icon name="cross" size={12} />
        </button>
      )}
    </div>
  );
}

export function PivotZone({ label, empty = 'Drag columns here', over, children }: { label: string; empty?: string; over?: boolean; children?: ReactNode }) {
  const has = Children.count(children) > 0;
  return (
    <div className={cx('ui-zone', over && 'is-over')}>
      <div className="ui-zone__head"><span className="ui-eyebrow">{label}</span></div>
      {has ? <div className="ui-zone__chips">{children}</div> : <div className="ui-zone__empty">{empty}</div>}
    </div>
  );
}
