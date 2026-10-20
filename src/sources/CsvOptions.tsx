// The read options of delimited text, shared by the inspector's Read options and the Format picker.
import { DELIMITERS, ENCODINGS, parseCount, parseNullStrings, withOption } from '../inspector/options';
import type { ParseOptions } from '../model';
import { CommitInput } from '../steps/StepForm';
import { Field, Select, Switch } from '../ui';

export function CsvOptions({ format, options: o, onChange, idPrefix = 'opt' }: { format: 'csv' | 'tsv'; options: ParseOptions; onChange: (options: ParseOptions) => void; idPrefix?: string }) {
  const set = <K extends keyof ParseOptions>(key: K, value: ParseOptions[K] | 'auto') => onChange(withOption(o, key, value));
  return (
    <>
      <Field label="Delimiter" htmlFor={`${idPrefix}-delimiter`}>
        <Select id={`${idPrefix}-delimiter`} options={DELIMITERS} value={o.delimiter ?? (format === 'tsv' ? '\t' : 'auto')} onChange={(e) => set('delimiter', e.target.value)} />
      </Field>
      <Switch id={`${idPrefix}-header`} label="First row is the header" checked={o.header ?? true} onChange={(on) => set('header', on ? 'auto' : false)} />
      <Field label="Skip lines at the top" htmlFor={`${idPrefix}-skip`} hint="Lines above the header, blank ones included.">
        <CommitInput key={o.skip ?? ''} id={`${idPrefix}-skip`} value={o.skip ? String(o.skip) : ''} onCommit={(v) => set('skip', parseCount(v))} placeholder="0" />
      </Field>
      <Field label="Skip rows at the bottom" htmlFor={`${idPrefix}-skip-bottom`} hint="Rows dropped from the end: a footer or a row count.">
        <CommitInput key={o.skipBottom ?? ''} id={`${idPrefix}-skip-bottom`} value={o.skipBottom ? String(o.skipBottom) : ''} onCommit={(v) => set('skipBottom', parseCount(v))} placeholder="0" />
      </Field>
      <Field label="Encoding" htmlFor={`${idPrefix}-encoding`}>
        <Select id={`${idPrefix}-encoding`} options={ENCODINGS} value={o.encoding ?? 'utf-8'} onChange={(e) => set('encoding', e.target.value === 'utf-8' ? 'auto' : e.target.value)} />
      </Field>
      <Field label="Quote character" htmlFor={`${idPrefix}-quote`} hint="Leave empty to detect it.">
        <CommitInput key={o.quote ?? ''} id={`${idPrefix}-quote`} value={o.quote ?? ''} onCommit={(v) => set('quote', v)} placeholder='"' />
      </Field>
      <Field label="Treat as empty" htmlFor={`${idPrefix}-nulls`} hint="Values read as empty, separated by commas.">
        <CommitInput key={(o.nullStrings ?? []).join(',')} id={`${idPrefix}-nulls`} value={(o.nullStrings ?? []).join(', ')} onCommit={(v) => set('nullStrings', parseNullStrings(v))} placeholder="NA, n/a" />
      </Field>
    </>
  );
}
