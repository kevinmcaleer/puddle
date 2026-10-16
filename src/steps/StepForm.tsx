import type { ColumnSchema } from '../model';
import { Banner, Button, columnKind, cx, Field, Select, Switch, TypeTag } from '../ui';
import { FILTER_OPS } from '../compiler';
import type { Detection } from '../dates';
import { CommitInput } from './CommitInput';
import { DateFormatsInput } from './DateFormatsInput';
import { ExpressionInput } from './ExpressionInput';
import { fieldErrors, stepForm, type FieldSpec } from './forms';

type Params = Record<string, unknown>;

export { CommitInput };

/** Toggle columns on and off. Columns the step names but its input no longer has are shown as missing. */
function ColumnsPicker({ id, value, columns, single, onChange }: { id: string; value: string[]; columns: ColumnSchema[]; single?: boolean; onChange: (v: string[]) => void }) {
  const names = new Set(columns.map((c) => c.name));
  const missing = value.filter((v) => !names.has(v));
  return (
    <div id={id} role="group" className="flex flex-wrap gap-1">
      {columns.map((c) => {
        const on = value.includes(c.name);
        return (
          <button
            key={c.name}
            type="button"
            aria-pressed={on}
            aria-label={c.name}
            title={c.type}
            className={cx('ui-chip font-mono', on && 'bg-brand-tint text-ink')}
            onClick={() => onChange(single ? [c.name] : on ? value.filter((v) => v !== c.name) : [...value, c.name])}
          >
            <TypeTag type={columnKind(c.type)} />
            {c.name}
          </button>
        );
      })}
      {missing.map((m) => (
        <button key={m} type="button" aria-pressed className="ui-chip font-mono text-fail line-through" title="This column isn’t in the step’s input any more" onClick={() => onChange(value.filter((v) => v !== m))}>
          {m}
        </button>
      ))}
      {!columns.length && !missing.length && <span className="text-ink-muted">No columns yet. Connect this node to a source.</span>}
    </div>
  );
}

function Renames({ value, columns, onChange }: { value: { from: string; to: string }[]; columns: ColumnSchema[]; onChange: (v: { from: string; to: string }[]) => void }) {
  const set = (i: number, patch: Partial<{ from: string; to: string }>) => onChange(value.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      {value.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <Select aria-label={`Column ${i + 1}`} options={[...new Set([r.from, ...columns.map((c) => c.name)])]} value={r.from} onChange={(e) => set(i, { from: e.target.value })} />
          <CommitInput key={r.to} aria-label={`New name ${i + 1}`} mono value={r.to} onCommit={(to) => set(i, { to })} />
          <Button variant="ghost" size="sm" icon="cross" iconOnly aria-label={`Remove rename ${i + 1}`} onClick={() => onChange(value.filter((_, k) => k !== i))} />
        </div>
      ))}
      <Button variant="ghost" size="sm" icon="plus" onClick={() => onChange([...value, { from: columns[0]?.name ?? '', to: columns[0]?.name ?? '' }])}>Add rename</Button>
    </div>
  );
}

type Condition = { column: string; op: string; value: string };

const OPS = Object.entries(FILTER_OPS).map(([value, label]) => ({ value, label }));
const NO_VALUE = new Set(['empty', 'notEmpty']);

function Conditions({ value, columns, onChange }: { value: Condition[]; columns: ColumnSchema[]; onChange: (v: Condition[]) => void }) {
  const set = (i: number, patch: Partial<Condition>) => onChange(value.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  return (
    <div className="flex flex-col gap-2">
      {value.map((c, i) => (
        <div key={i} className="flex flex-col gap-1 border-b border-line pb-2">
          <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <Select aria-label={`Condition ${i + 1} column`} options={[...new Set([c.column, ...columns.map((x) => x.name)])]} value={c.column} onChange={(e) => set(i, { column: e.target.value })} />
            <Select aria-label={`Condition ${i + 1} comparison`} options={OPS} value={c.op} onChange={(e) => set(i, { op: e.target.value })} />
            <Button variant="ghost" size="sm" icon="cross" iconOnly aria-label={`Remove condition ${i + 1}`} onClick={() => onChange(value.filter((_, k) => k !== i))} />
          </div>
          {!NO_VALUE.has(c.op) && <CommitInput key={c.value} aria-label={`Condition ${i + 1} value`} mono value={c.value} onCommit={(v) => set(i, { value: v })} />}
        </div>
      ))}
      <Button variant="ghost" size="sm" icon="plus" onClick={() => onChange([...value, { column: columns[0]?.name ?? '', op: 'equals', value: '' }])}>Add condition</Button>
    </div>
  );
}

type SortKey = { column: string; descending: boolean };

function SortKeys({ value, columns, onChange }: { value: SortKey[]; columns: ColumnSchema[]; onChange: (v: SortKey[]) => void }) {
  const set = (i: number, patch: Partial<SortKey>) => onChange(value.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  return (
    <div className="flex flex-col gap-2">
      {value.map((k, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <Select aria-label={`Sort column ${i + 1}`} options={[...new Set([k.column, ...columns.map((x) => x.name)])]} value={k.column} onChange={(e) => set(i, { column: e.target.value })} />
          <Select
            aria-label={`Sort direction ${i + 1}`}
            options={[
              { value: 'asc', label: 'Smallest first' },
              { value: 'desc', label: 'Largest first' },
            ]}
            value={k.descending ? 'desc' : 'asc'}
            onChange={(e) => set(i, { descending: e.target.value === 'desc' })}
          />
          <Button variant="ghost" size="sm" icon="cross" iconOnly aria-label={`Remove sort column ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button variant="ghost" size="sm" icon="plus" onClick={() => onChange([...value, { column: columns[0]?.name ?? '', descending: false }])}>Add sort column</Button>
    </div>
  );
}

function FieldInput({ field, value, params, columns, error, detectDates, onChange }: { field: FieldSpec; value: unknown; params: Params; columns: ColumnSchema[]; error?: string; detectDates?: (column: string) => Promise<Detection>; onChange: (v: unknown) => void }) {
  const id = `step-${field.key}`;
  switch (field.kind) {
    case 'columns':
      return <ColumnsPicker id={id} value={Array.isArray(value) ? (value as string[]) : []} columns={columns} onChange={onChange} />;
    case 'column':
      return <ColumnsPicker id={id} single value={typeof value === 'string' && value ? [value] : []} columns={columns} onChange={(v) => onChange(v[0] ?? '')} />;
    case 'text':
      return <CommitInput key={String(value ?? '')} id={id} mono={field.mono} placeholder={field.placeholder} error={!!error} value={String(value ?? '')} onCommit={onChange} />;
    case 'number':
      return (
        <CommitInput
          key={String(value ?? '')}
          id={id}
          error={!!error}
          value={value == null ? '' : String(value)}
          onCommit={(v) => onChange(v.trim() === '' ? undefined : Number(v))}
        />
      );
    case 'select':
      return <Select id={id} options={field.options} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'switch':
      return <Switch id={id} label={field.label} checked={!!value} onChange={onChange} />;
    case 'list': {
      const items = Array.isArray(value) ? value.map(String) : [];
      return (
        <CommitInput
          key={items.join(',')}
          id={id}
          mono
          error={!!error}
          value={items.join(', ')}
          onCommit={(v) => {
            const parts = v.split(',').map((x) => x.trim()).filter(Boolean);
            onChange(field.of === 'number' ? parts.map(Number) : parts);
          }}
        />
      );
    }
    case 'expression':
      return <ExpressionInput key={String(value ?? '')} id={id} value={String(value ?? '')} columns={columns} error={!!error} onCommit={onChange} />;
    case 'sql':
      return <ExpressionInput key={String(value ?? '')} id={id} rows={8} placeholder={field.placeholder} value={String(value ?? '')} columns={columns} error={!!error} onCommit={onChange} />;
    case 'conditions':
      return <Conditions value={Array.isArray(value) ? (value as Condition[]) : []} columns={columns} onChange={onChange} />;
    case 'sortKeys':
      return <SortKeys value={Array.isArray(value) ? (value as SortKey[]) : []} columns={columns} onChange={onChange} />;
    case 'dateFormats': {
      const cols = params.columns;
      const column = Array.isArray(cols) && typeof cols[0] === 'string' ? cols[0] : '';
      return <DateFormatsInput id={id} value={Array.isArray(value) ? value.map(String) : []} column={column} detect={detectDates} onChange={onChange} />;
    }
    case 'renames':
      return <Renames value={Array.isArray(value) ? (value as { from: string; to: string }[]) : []} columns={columns} onChange={onChange} />;
  }
}

/** A form built from a field list, with field errors shown before anything runs. Steps and rules share it. */
export function FormFields({
  fields,
  params,
  errors,
  columns,
  detectDates,
  onChange,
  testId,
}: {
  fields: FieldSpec[];
  params: Params;
  errors: Record<string, string>;
  columns: ColumnSchema[];
  detectDates?: (column: string) => Promise<Detection>;
  onChange: (params: Params) => void;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {fields.filter((f) => !f.when || f.when(params)).map((f) =>
        f.kind === 'switch' ? (
          <FieldInput key={f.key} field={f} value={params[f.key]} params={params} columns={columns} onChange={(v) => onChange({ ...params, [f.key]: v })} />
        ) : (
          <Field key={f.key} label={f.label} htmlFor={`step-${f.key}`} hint={f.hint} error={f.kind === 'sql' ? undefined : errors[f.key]}>
            <FieldInput field={f} value={params[f.key]} params={params} columns={columns} error={errors[f.key]} detectDates={detectDates} onChange={(v) => onChange({ ...params, [f.key]: v })} />
            {/* A refused query gets a banner: the reason can be long, and nothing runs until it's fixed. */}
            {f.kind === 'sql' && errors[f.key] && (
              <Banner tone="fail" title="This query can’t run as a step">
                {errors[f.key]}
              </Banner>
            )}
          </Field>
        ),
      )}
    </div>
  );
}

/** The settings form for one step. */
export function StepForm({ type, params, columns, detectDates, onChange }: { type: string; params: Params; columns: ColumnSchema[]; detectDates?: (column: string) => Promise<Detection>; onChange: (params: Params) => void }) {
  const form = stepForm(type);
  if (!form) return <p className="text-ink-muted">This step type has no settings form.</p>;
  return <FormFields testId="step-form" fields={form.fields} params={params} errors={fieldErrors({ type, params })} columns={columns} detectDates={detectDates} onChange={onChange} />;
}
