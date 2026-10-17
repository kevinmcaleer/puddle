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

/** `decorative` hides the tag from screen readers, where the type is said another way (a chip's own title) and the tag's text would only get in the way of its name. */
export function TypeTag({ type = 'text', decorative }: { type?: ColumnKind; decorative?: boolean }) {
  const t = TYPES[type];
  return (
    <span className="ui-type" title={t.title} aria-hidden={decorative || undefined}>
      {t.icon ? <Icon name={t.icon} size={12} /> : t.label}
    </span>
  );
}
