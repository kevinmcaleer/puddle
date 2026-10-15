import { StatusBadge } from './StatusBadge';
import { TypeTag, type ColumnKind } from './TypeTag';

export function SchemaPopover({ title, columns, broken }: { title?: string; columns: Array<{ name: string; type?: ColumnKind; missing?: boolean }>; broken?: string }) {
  return (
    <div className="ui-popover" role="tooltip">
      <div className="ui-popover__head">
        <span className="ui-eyebrow">{title ?? 'Schema'}</span>
        <span className="ui-metric">{columns.length} cols</span>
      </div>
      <ul className="ui-schema">
        {columns.map((c) => (
          <li key={c.name} className={c.missing ? 'is-missing' : undefined}>
            <TypeTag type={c.type} />
            <span className="ui-col">{c.name}</span>
          </li>
        ))}
      </ul>
      {broken && (
        <div className="ui-popover__foot"><StatusBadge status="fail">{broken}</StatusBadge></div>
      )}
    </div>
  );
}
