// The column mapping's controls, shared by the templates library and recipes: the columns expected, and for each
// one the input lacks, a pick list of the input's columns to use in its place.
import type { ColumnSchema } from '../model';
import { Banner, columnKind, Field, FieldChip, Select } from '../ui';
import { missingColumns } from './mapping';

/** Expected columns as field chips, with their types. */
export function Columns({ columns, testId }: { columns: ColumnSchema[]; testId?: string }) {
  if (!columns.length) return <p className="text-label text-ink-muted">Reads no input columns by name.</p>;
  return (
    <div className="flex flex-wrap gap-1" data-testid={testId}>
      {columns.map((c) => (
        <FieldChip key={c.name} name={c.name} type={columnKind(c.type)} onRemove={false} draggable={false} />
      ))}
    </div>
  );
}

/** For each expected column the input lacks, a pick list of the input's columns to use in its place. */
export function Mapping({
  expected,
  actual,
  mapping,
  onChange,
  what = 'this template',
  testId = 'template-mapping',
}: {
  expected: ColumnSchema[];
  actual: ColumnSchema[];
  mapping: Record<string, string | undefined>;
  onChange: (expected: string, column: string) => void;
  /** What expects the columns, for the message when nothing is missing. */
  what?: string;
  testId?: string;
}) {
  const missing = missingColumns(expected, actual);
  if (!missing.length) return <p className="text-label text-ink-muted">The input has every column {what} expects.</p>;
  const unmapped = missing.filter((m) => !mapping[m.expected.name]).length;
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <Banner tone="warn" title={`${missing.length} ${missing.length === 1 ? 'column isn’t' : 'columns aren’t'} in the input`}>
        Pick a column to use in place of each. {unmapped ? 'Steps that read an unmapped column arrive turned off.' : 'Every one is mapped.'}
      </Banner>
      {missing.map((m) => (
        <Field key={m.expected.name} label={`Use for ${m.expected.name}`} htmlFor={`map-${m.expected.name}`}>
          <Select
            id={`map-${m.expected.name}`}
            value={mapping[m.expected.name] ?? ''}
            options={[{ value: '', label: 'Leave unmapped' }, ...actual.map((a) => ({ value: a.name, label: a.name }))]}
            onChange={(e) => onChange(m.expected.name, e.target.value)}
          />
        </Field>
      ))}
    </div>
  );
}
