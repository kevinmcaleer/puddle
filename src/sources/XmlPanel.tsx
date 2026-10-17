import { setParseOptions, useProjectStore, type ParseOptions, type Source } from '../model';
import { Banner, Field, Section, Select } from '../ui';
import { pathLabel } from '../xml';
import { useAttachments } from './attachments';
import { recordLabel, useXmlReads, withRecord } from './xml';

/** Why XML can't be shown yet: being read, or what went wrong. Shared by the inspector and the results. */
export function XmlProblemBanner({ source }: { source: Source }) {
  const read = useXmlReads((s) => s.reads[source.id]);
  if (read?.state === 'failed') return <Banner tone="fail" title="This XML can’t be read">{read.message}</Banner>;
  return <Banner tone="info" title="Reading the XML">Puddle finds the repeating elements and reads them into rows, so a large file takes a moment.</Banner>;
}

const lastName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** The inspector's read options for an XML source: which repeating element is a record, and what gets a row. */
export function XmlPanel({ source }: { source: Source }) {
  const apply = useProjectStore((s) => s.apply);
  const read = useXmlReads((s) => s.reads[source.id]);
  const attached = useAttachments((s) => (s.sources[source.id] ?? 'detached') !== 'detached');
  const o = source.parseOptions;
  const set = (next: ParseOptions) => apply((p) => setParseOptions(p, source.id, next));

  const records = read?.records;
  const current = o.record ?? (read?.state === 'ok' ? read.record : records?.[0]?.path) ?? '';
  const recordOptions = records?.length ? records.map((c) => ({ value: c.path, label: recordLabel(c) })) : [{ value: current, label: current ? pathLabel(current) : 'Detect' }];
  if (current && !recordOptions.some((r) => r.value === current)) recordOptions.unshift({ value: current, label: `${pathLabel(current)} (not in this file)` });

  const name = lastName(current) || 'record';
  const expandable = read?.state === 'ok' ? read.expandable : [];
  const rowOptions = [{ value: '', label: name }, ...expandable.map((p) => ({ value: p, label: `${pathLabel(p)} in each ${name}` }))];
  if (o.expand && !expandable.includes(o.expand)) rowOptions.push({ value: o.expand, label: `${pathLabel(o.expand)} in each ${name}` });

  return (
    <Section title="Read options">
      <div className="flex flex-col gap-3" data-testid="xml-panel" data-state={read?.state ?? 'none'}>
        <Field label="Record element" htmlFor="opt-record" hint="The repeating element that becomes a row. The number is how many there are.">
          <Select id="opt-record" options={recordOptions} value={current} disabled={!records?.length} onChange={(e) => set(withRecord(o, e.target.value))} />
        </Field>
        <Field label="A row for each" htmlFor="opt-expand" hint="Elements that repeat inside a record are kept as JSON, or each given a row of its own.">
          <Select
            id="opt-expand"
            options={rowOptions}
            value={o.expand ?? ''}
            disabled={rowOptions.length < 2}
            onChange={(e) => {
              const next = { ...o };
              if (e.target.value) next.expand = e.target.value;
              else delete next.expand;
              set(next);
            }}
          />
        </Field>
        {read?.state === 'ok' && (
          <p className="text-label text-ink-muted" data-testid="xml-size">
            {`${read.rows.toLocaleString('en-GB')} ${read.rows === 1 ? 'row' : 'rows'}, ${read.columns} ${read.columns === 1 ? 'column' : 'columns'}`}
          </p>
        )}
        {attached && read?.state === 'failed' && <XmlProblemBanner source={source} />}
      </div>
    </Section>
  );
}
