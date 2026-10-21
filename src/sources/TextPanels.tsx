// The inspector's read options for fixed-width text (the boundaries over the first lines, as a ruler) and pipe
// tables, and the banner shown while either is being read or when it can't be.
import type { ParseOptions, Source } from '../model';
import { candidateLabel } from '../structured';
import { Banner, Field, Ruler, Select } from '../ui';
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
