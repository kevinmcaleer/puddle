import { CSV_DELIMITERS, EXPORT_FORMATS, exportFileName, exportOptions, PARQUET_COMPRESSION, type ExportFormat } from '../compiler';
import { ExportBlockedBanner, ExportButton } from '../export';
import { setOutputSpec, useProject, useProjectStore, type OutputNode } from '../model';
import { CommitInput } from '../steps/CommitInput';
import { Field, Section, Select, Switch } from '../ui';

const FORMATS = (Object.keys(EXPORT_FORMATS) as ExportFormat[]).map((value) => ({ value, label: value === 'clipboard' ? 'Copy to clipboard' : EXPORT_FORMATS[value].label }));
const DELIMITER_LABELS: Record<(typeof CSV_DELIMITERS)[number], string> = { ',': 'Comma', ';': 'Semicolon', '\t': 'Tab', '|': 'Pipe' };
const COMPRESSION_LABELS: Record<(typeof PARQUET_COMPRESSION)[number], string> = { zstd: 'Zstandard (smallest)', snappy: 'Snappy (fastest)', uncompressed: 'None' };

const time = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** An Output node's export settings, its export button and what it has exported. */
export function OutputPanel({ node }: { node: OutputNode }) {
  const apply = useProjectStore((s) => s.apply);
  const log = useProject().exportLog.filter((e) => e.nodeId === node.id);
  const spec = node.outputSpec;
  const set = (patch: Partial<OutputNode['outputSpec']>) => apply((p) => setOutputSpec(p, node.id, patch));
  const options = (() => {
    try {
      return exportOptions(spec) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const setOption = (key: string, value: unknown) => set({ options: { ...options, [key]: value } });
  return (
    <>
      <Section title="Export">
        <div className="flex flex-col gap-3" data-testid="output-settings">
          <Field label="Format" htmlFor="out-format">
            <Select id="out-format" options={FORMATS} value={spec.format} onChange={(e) => set({ format: e.target.value as ExportFormat, options: {} })} />
          </Field>
          {spec.format !== 'clipboard' && (
            <Field label="File name" htmlFor="out-file" hint={`Saved as ${exportFileName(node.name, spec)}.`}>
              <CommitInput key={spec.fileName ?? ''} id="out-file" value={spec.fileName ?? ''} placeholder={exportFileName(node.name, { format: spec.format })} onCommit={(v) => set({ fileName: v.trim() || undefined })} />
            </Field>
          )}
          {spec.format === 'csv' && (
            <Field label="Delimiter" htmlFor="out-delimiter">
              <Select id="out-delimiter" options={CSV_DELIMITERS.map((d) => ({ value: d, label: DELIMITER_LABELS[d] }))} value={String(options.delimiter)} onChange={(e) => setOption('delimiter', e.target.value)} />
            </Field>
          )}
          {(spec.format === 'csv' || spec.format === 'clipboard') && <Switch id="out-header" label="Include column names" checked={options.header !== false} onChange={(on) => setOption('header', on)} />}
          {spec.format === 'parquet' && (
            <Field label="Compression" htmlFor="out-compression">
              <Select id="out-compression" options={PARQUET_COMPRESSION.map((c) => ({ value: c, label: COMPRESSION_LABELS[c] }))} value={String(options.compression)} onChange={(e) => setOption('compression', e.target.value)} />
            </Field>
          )}
          <ExportBlockedBanner node={node} />
          <div>
            <ExportButton node={node} size="md" />
          </div>
        </div>
      </Section>
      <Section title="Export log" count={log.length}>
        {log.length ? (
          <ul className="flex flex-col gap-2" data-testid="export-log">
            {log.map((e) => (
              <li key={e.id} className="flex flex-col">
                <span className="text-body-strong text-ink">
                  {e.fileName} · {e.rows} {e.rows === 1 ? 'row' : 'rows'}
                </span>
                <span className="text-label text-ink-muted">{time(e.at)}</span>
                {e.overridden?.length ? <span className="text-label text-fail">Exported anyway past {e.overridden.map((o) => `${o.rule} (${o.nodeName})`).join(', ')}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">Nothing exported yet.</p>
        )}
      </Section>
    </>
  );
}
