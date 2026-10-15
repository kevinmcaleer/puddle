import type { ColumnKind } from './columnKind';
import { Icon } from './Icon';

export type { ColumnKind };

const TYPES: Record<ColumnKind, { label?: string; icon?: 'calendar' | 'clock'; title: string }> = {
  text: { label: 'Abc', title: 'VARCHAR' },
  integer: { label: '123', title: 'INTEGER' },
  decimal: { label: '1.5', title: 'DOUBLE' },
  boolean: { label: 'T/F', title: 'BOOLEAN' },
  date: { icon: 'calendar', title: 'DATE' },
  timestamp: { icon: 'clock', title: 'TIMESTAMP' },
  json: { label: '{ }', title: 'JSON / STRUCT' },
};

export function TypeTag({ type = 'text' }: { type?: ColumnKind }) {
  const t = TYPES[type];
  return (
    <span className="ui-type" title={t.title}>
      {t.icon ? <Icon name={t.icon} size={12} /> : t.label}
    </span>
  );
}
