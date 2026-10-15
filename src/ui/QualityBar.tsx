import { cx } from './cx';
import { Icon } from './Icon';
import { TypeTag, type ColumnKind } from './TypeTag';

export interface Quality {
  valid?: number;
  empty?: number;
  error?: number;
}

export function QualityBar({ valid = 1, empty = 0, error = 0 }: Quality) {
  const total = valid + empty + error || 1;
  const pct = (n: number) => (100 * n) / total;
  const label = `${pct(valid).toFixed(1)}% valid, ${pct(empty).toFixed(1)}% empty, ${pct(error).toFixed(1)}% error`;
  return (
    <div className="ui-qbar" role="img" aria-label={label} title={label}>
      <span className="valid" style={{ width: pct(valid) + '%' }} />
      <span className="empty" style={{ width: pct(empty) + '%' }} />
      <span className="error" style={{ width: pct(error) + '%' }} />
    </div>
  );
}

export function ColumnHeader({ name, type, quality, selected, width = 160 }: { name: string; type?: ColumnKind; quality?: Quality; selected?: boolean; width?: number | string }) {
  return (
    <div className={cx('ui-colhead', selected && 'is-selected')} style={{ width }}>
      <div className="ui-colhead__top">
        <TypeTag type={type} />
        <span className="ui-colhead__name" title={name}>{name}</span>
        <Icon name="chevron-down" size={14} className="ui-colhead__menu" />
      </div>
      <QualityBar {...(quality ?? {})} />
    </div>
  );
}
