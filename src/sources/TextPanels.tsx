// The inspector's read options for fixed-width text (the boundaries over the first lines, as a ruler) and pipe
// tables, and the banner shown while either is being read or when it can't be.
import type { ParseOptions, Source } from '../model';
import { candidateLabel } from '../structured';
import { LOG_PRESETS, logPreset } from '../logs';
import { Banner, Field, Ruler, Select, TextInput } from '../ui';
import { EncodingField, HeaderSwitch, NullStringsField, SkipFields } from './CsvOptions';
import { withBoundary } from './fixedWidth';
import { useRewrites } from './rewrite';

/** Why the rows aren't there yet: being read, or what went wrong. Shared by the inspector and the results. */
export function RewriteProblemBanner({ source }: { source: Source }) {
  const read = useRewrites((s) => s.reads[source.id]);
  if (read?.state === 'failed') return <Banner tone="fail" title="This file can’t be read">{read.message}</Banner>;
  return <Banner tone="info" title="Reading the file">Puddle reads the lines into rows first, so a large file takes a moment.</Banner>;
}

const plural = (n: number, word: string) => `${n.toLocaleString('en-GB')} ${n === 1 ? word : `${word}s`}`;

export function FixedWidthOptions({ source, onChange }: { source: Source; onChange: (options: ParseOptions) => void }) {
  const o = source.parseOptions;
  const read = useRewrites((s) => s.reads[source.id]);
  const lines = (read?.state === 'ok' || read?.state === 'reading' ? read.lines : undefined) ?? [];
  const boundaries = o.boundaries ?? (read?.state === 'ok' ? read.boundaries : undefined) ?? [];
  const set = (next: number[]) => onChange({ ...o, boundaries: next });
  const props = { options: o, onChange };
  return (
    <>
      <Field label="Column boundaries" hint="Click between two characters to add a boundary, drag one to move it, click one to remove it.">
        {lines.length ? (
          <Ruler lines={lines} boundaries={boundaries} onAdd={(at) => set(withBoundary(boundaries, at))} onMove={(from, to) => set(withBoundary(boundaries, from, to))} onRemove={(at) => set(withBoundary(boundaries, at))} />
        ) : (
          <p className="text-label text-ink-muted">The first lines show here once the file is read.</p>
        )}
      </Field>
      {read?.state === 'ok' && (
        <p className="text-label text-ink-muted" data-testid="rewrite-size">
          {`${plural(read.rows, 'row')}, ${plural(read.columns, 'column')}`}
        </p>
      )}
      <HeaderSwitch {...props} />
      <SkipFields {...props} />
      <EncodingField {...props} />
      <NullStringsField {...props} />
      {read?.state === 'failed' && <RewriteProblemBanner source={source} />}
    </>
  );
}

export function PipesOptions({ source, onChange }: { source: Source; onChange: (options: ParseOptions) => void }) {
  const read = useRewrites((s) => s.reads[source.id]);
  const props = { options: source.parseOptions, onChange };
  return (
    <>
      <HeaderSwitch {...props} />
      {read?.state === 'ok' && (
        <p className="text-label text-ink-muted" data-testid="rewrite-size">
          {`${plural(read.rows, 'row')}, ${plural(read.columns, 'column')}${read.dropped ? `; ${plural(read.dropped, 'line')} around the table left out` : ''}`}
        </p>
      )}
      <EncodingField {...props} />
      <NullStringsField {...props} />
      {read?.state === 'failed' && <RewriteProblemBanner source={source} />}
    </>
  );
}

/** The inspector's read options for a log file: the preset its lines are read as, or a custom pattern. */
export function LogOptions({ source, onChange }: { source: Source; onChange: (options: ParseOptions) => void }) {
  const o = source.parseOptions;
  const read = useRewrites((s) => s.reads[source.id]);
  const preset = logPreset(o.preset ?? (read?.state === 'ok' ? read.preset : undefined));
  const props = { options: o, onChange };
  return (
    <>
      <Field label="Lines" htmlFor="opt-preset" hint={preset.hint}>
        <Select id="opt-preset" options={LOG_PRESETS.map((p) => ({ value: p.id, label: p.label }))} value={preset.id} onChange={(e) => onChange({ ...o, preset: e.target.value })} />
      </Field>
      {preset.id === 'custom' && (
        <Field label="Pattern" htmlFor="opt-pattern" hint="A regular expression; each named group (?<name>…) is a column.">
          <TextInput id="opt-pattern" mono value={o.pattern ?? ''} placeholder="(?<time>\S+) (?<level>\w+) (?<message>.*)" spellCheck={false} onChange={(e) => onChange({ ...o, pattern: e.target.value })} />
        </Field>
      )}
      {read?.state === 'ok' && (
        <p className="text-label text-ink-muted" data-testid="rewrite-size">
          {`${plural(read.rows, 'row')}, ${plural(read.columns, 'column')}${read.unmatched ? `; ${plural(read.unmatched, 'line')} didn’t fit and ${read.unmatched === 1 ? 'was' : 'were'} left out` : ''}`}
        </p>
      )}
      <EncodingField {...props} />
      <NullStringsField {...props} />
      {read?.state === 'failed' && <RewriteProblemBanner source={source} />}
    </>
  );
}

/** The inspector's read options for YAML, TOML, INI and GeoJSON: which records become the rows. */
export function StructuredOptions({ source, onChange }: { source: Source; onChange: (options: ParseOptions) => void }) {
  const o = source.parseOptions;
  const read = useRewrites((s) => s.reads[source.id]);
  const candidates = read?.state === 'ok' ? (read.candidates ?? []) : [];
  const current = o.record ?? (read?.state === 'ok' ? read.record : undefined) ?? '';
  const options = candidates.length ? candidates.map((c) => ({ value: c.path, label: candidateLabel(c) })) : [{ value: current, label: current || 'Detect' }];
  if (!options.some((c) => c.value === current)) options.unshift({ value: current, label: `${current} (not in this file)` });
  const props = { options: o, onChange };
  return (
    <>
      <Field label="Records" htmlFor="opt-record" hint="The list or map in the file whose entries become rows. Nested fields become dotted columns; lists inside a record stay as JSON.">
        <Select
          id="opt-record"
          options={options}
          value={current}
          disabled={candidates.length < 2}
          onChange={(e) => {
            const next = { ...o, record: e.target.value };
            onChange(next);
          }}
        />
      </Field>
      {read?.state === 'ok' && (
        <p className="text-label text-ink-muted" data-testid="rewrite-size">
          {`${plural(read.rows, 'row')}, ${plural(read.columns, 'column')}`}
        </p>
      )}
      <EncodingField {...props} />
      <NullStringsField {...props} />
      {read?.state === 'failed' && <RewriteProblemBanner source={source} />}
    </>
  );
}
