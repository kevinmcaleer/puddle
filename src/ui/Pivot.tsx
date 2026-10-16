import { Children, isValidElement, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import { TypeTag, type ColumnKind } from './TypeTag';

/**
 * A field in a pivot zone. `agg` is the value's aggregate: text draws the tag, an element (such as a menu
 * trigger with the `ui-fchip__agg` class) is drawn as given. `label` likewise replaces the name's text.
 */
export function FieldChip({
  name,
  type,
  agg,
  label,
  onRemove,
  ...rest
}: { name: string; type?: ColumnKind; agg?: ReactNode; label?: ReactNode; onRemove?: (() => void) | false } & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  return (
    <div className="ui-fchip" draggable {...rest}>
      <Icon name="grip" size={14} className="ui-fchip__grip" />
      <TypeTag type={type} />
      {isValidElement(label) ? label : <span className="ui-fchip__name">{label ?? name}</span>}
      {agg != null && (isValidElement(agg) ? agg : <span className="ui-fchip__agg">{agg}</span>)}
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
