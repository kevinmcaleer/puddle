// The read options of delimited text, shared by the inspector's Read options and the Format picker. The fields
// that fixed-width text and pipe tables share with it (header, skips, encoding, words for empty) are exported.
import { DELIMITERS, ENCODINGS, parseCount, parseNullStrings, withOption } from '../inspector/options';
import type { ParseOptions } from '../model';
import { CommitInput } from '../steps/StepForm';
import { Field, Select, Switch } from '../ui';

interface OptionProps {
  options: ParseOptions;
  onChange: (options: ParseOptions) => void;
  idPrefix?: string;
}

const setter = ({ options, onChange }: OptionProps) => <K extends keyof ParseOptions>(key: K, value: ParseOptions[K] | 'auto') => onChange(withOption(options, key, value));

export function HeaderSwitch(props: OptionProps) {
  const set = setter(props);
  return <Switch id={`${props.idPrefix ?? 'opt'}-header`} label="First row is the header" checked={props.options.header ?? true} onChange={(on) => set('header', on ? 'auto' : false)} />;
}

export function SkipFields(props: OptionProps) {
  const set = setter(props);
  const { options: o, idPrefix = 'opt' } = props;
  return (
    <>
      <Field label="Skip lines at the top" htmlFor={`${idPrefix}-skip`} hint="Lines above the header, blank ones included.">
        <CommitInput key={o.skip ?? ''} id={`${idPrefix}-skip`} value={o.skip ? String(o.skip) : ''} onCommit={(v) => set('skip', parseCount(v))} placeholder="0" />
      </Field>
      <Field label="Skip rows at the bottom" htmlFor={`${idPrefix}-skip-bottom`} hint="Rows dropped from the end: a footer or a row count.">
        <CommitInput key={o.skipBottom ?? ''} id={`${idPrefix}-skip-bottom`} value={o.skipBottom ? String(o.skipBottom) : ''} onCommit={(v) => set('skipBottom', parseCount(v))} placeholder="0" />
      </Field>
    </>
  );
}

export function EncodingField(props: OptionProps) {
  const set = setter(props);
  const { options: o, idPrefix = 'opt' } = props;
  return (
    <Field label="Encoding" htmlFor={`${idPrefix}-encoding`}>
      <Select id={`${idPrefix}-encoding`} options={ENCODINGS} value={o.encoding ?? 'utf-8'} onChange={(e) => set('encoding', e.target.value === 'utf-8' ? 'auto' : e.target.value)} />
    </Field>
  );
}

export function NullStringsField(props: OptionProps) {
  const set = setter(props);
  const { options: o, idPrefix = 'opt' } = props;
  return (
    <Field label="Treat as empty" htmlFor={`${idPrefix}-nulls`} hint="Values read as empty, separated by commas.">
      <CommitInput key={(o.nullStrings ?? []).join(',')} id={`${idPrefix}-nulls`} value={(o.nullStrings ?? []).join(', ')} onCommit={(v) => set('nullStrings', parseNullStrings(v))} placeholder="NA, n/a" />
    </Field>
  );
}

export function CsvOptions({ format, options: o, onChange, idPrefix = 'opt' }: { format: 'csv' | 'tsv' } & OptionProps) {
  const props = { options: o, onChange, idPrefix };
  const set = setter(props);
  return (
    <>
      <Field label="Delimiter" htmlFor={`${idPrefix}-delimiter`}>
        <Select id={`${idPrefix}-delimiter`} options={DELIMITERS} value={o.delimiter ?? (format === 'tsv' ? '\t' : 'auto')} onChange={(e) => set('delimiter', e.target.value)} />
      </Field>
      <HeaderSwitch {...props} />
      <SkipFields {...props} />
      <EncodingField {...props} />
      <Field label="Quote character" htmlFor={`${idPrefix}-quote`} hint="Leave empty to detect it.">
        <CommitInput key={o.quote ?? ''} id={`${idPrefix}-quote`} value={o.quote ?? ''} onCommit={(v) => set('quote', v)} placeholder='"' />
      </Field>
      <NullStringsField {...props} />
    </>
  );
}
