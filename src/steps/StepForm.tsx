import { useState } from 'react';
import type { ColumnSchema } from '../model';
import { Button, columnKind, cx, Field, Select, Switch, TextInput, TypeTag } from '../ui';
import { fieldErrors, stepForm, type FieldSpec } from './forms';

type Params = Record<string, unknown>;

/** A text input that commits on Enter or blur, so typing doesn't add an undo step per key. Key it by value to reset. */
export function CommitInput({ value, onCommit, ...rest }: { id?: string; value: string; onCommit: (v: string) => void; mono?: boolean; placeholder?: string; error?: boolean; 'aria-label'?: string }) {
  const [draft, setDraft] = useState(value);
  const commit = () => draft !== value && onCommit(draft);
  return <TextInput {...rest} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

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

function FieldInput({ field, value, columns, error, onChange }: { field: FieldSpec; value: unknown; columns: ColumnSchema[]; error?: string; onChange: (v: unknown) => void }) {
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
    case 'renames':
      return <Renames value={Array.isArray(value) ? (value as { from: string; to: string }[]) : []} columns={columns} onChange={onChange} />;
  }
}

/** The settings form for one step, built from its field list, with field errors shown before anything runs. */
export function StepForm({ type, params, columns, onChange }: { type: string; params: Params; columns: ColumnSchema[]; onChange: (params: Params) => void }) {
  const form = stepForm(type);
  if (!form) return <p className="text-ink-muted">This step type has no settings form.</p>;
  const errors = fieldErrors({ type, params });
  return (
    <div className="flex flex-col gap-3" data-testid="step-form">
      {form.fields.map((f) =>
        f.kind === 'switch' ? (
          <FieldInput key={f.key} field={f} value={params[f.key]} columns={columns} onChange={(v) => onChange({ ...params, [f.key]: v })} />
        ) : (
          <Field key={f.key} label={f.label} htmlFor={`step-${f.key}`} hint={f.hint} error={errors[f.key]}>
            <FieldInput field={f} value={params[f.key]} columns={columns} error={errors[f.key]} onChange={(v) => onChange({ ...params, [f.key]: v })} />
          </Field>
        ),
      )}
    </div>
  );
}
