import { CSV_DELIMITERS, EXPORT_FORMATS, exportFileName, exportOptions, PARQUET_COMPRESSION, type ExportFormat } from '../compiler';
import { useState } from 'react';
import { SHEET_ROWS, sheetNameProblem, toSheetName } from '../excel/limits';
import { ExportBlockedBanner, ExportButton, formatName } from '../export';
import { useNodeStatus } from '../flow/status';
import { setOutputSpec, useProject, useProjectStore, type OutputNode } from '../model';
import { QualityReportButton } from '../report';
import { CommitInput } from '../steps/CommitInput';
import { Banner, Button, Field, Section, Select, Switch } from '../ui';

const FORMATS = (Object.keys(EXPORT_FORMATS) as ExportFormat[]).map((value) => ({ value, label: formatName(value) }));
const DELIMITER_LABELS: Record<(typeof CSV_DELIMITERS)[number], string> = { ',': 'Comma', ';': 'Semicolon', '\t': 'Tab', '|': 'Pipe' };
const COMPRESSION_LABELS: Record<(typeof PARQUET_COMPRESSION)[number], string> = { zstd: 'Zstandard (smallest)', snappy: 'Snappy (fastest)', uncompressed: 'None' };

const time = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Above Excel's row limit an export would be refused, so say so before it is tried and offer formats without one.
 * The row count shown on the node is used; in sample mode the full data has at least as many.
 */
function SheetRowLimit({ node, header, onFormat }: { node: OutputNode; header: boolean; onFormat: (f: ExportFormat) => void }) {
  const status = useNodeStatus(node.id);
  const rows = status.state === 'ok' ? status.rows : undefined;
  const room = SHEET_ROWS - (header ? 1 : 0);
  if (rows == null || rows <= room) return null;
  return (
    <div data-testid="sheet-row-limit">
      <Banner
        tone="warn"
        title="Too many rows for Excel"
        action={
          <div className="flex flex-col gap-2">
            <Button size="sm" variant="secondary" onClick={() => onFormat('csv')}>Use CSV</Button>
            <Button size="sm" variant="secondary" onClick={() => onFormat('parquet')}>Use Parquet</Button>
          </div>
        }
      >
        This output has {rows.toLocaleString('en-GB')} rows; an Excel sheet holds at most {room.toLocaleString('en-GB')}{header ? ' below its header' : ''}. Export it as CSV or Parquet instead, which have no row limit.
      </Banner>
    </div>
  );
}

/** Excel's settings: the sheet's name, the header row, and freezing it. */
function SheetOptions({ node, options, setOption }: { node: OutputNode; options: Record<string, unknown>; setOption: (key: string, value: unknown) => void }) {
  const [error, setError] = useState<string>();
  const name = typeof options.sheetName === 'string' ? options.sheetName : '';
  const header = options.header !== false;
  return (
    <>
      <Field label="Sheet name" htmlFor="out-sheet" hint="Leave empty to use the node’s name." error={error}>
        <CommitInput
          key={name}
          id="out-sheet"
          value={name}
          placeholder={toSheetName(node.name)}
          error={!!error}
          onCommit={(v) => {
            const text = v.trim();
            const problem = text ? sheetNameProblem(text) : undefined;
            setError(problem);
            if (!problem) setOption('sheetName', text || undefined);
          }}
        />
      </Field>
      <Switch id="out-header" label="Include column names" checked={header} onChange={(on) => setOption('header', on)} />
      {header && <Switch id="out-freeze" label="Freeze the header row" checked={options.freezeHeader !== false} onChange={(on) => setOption('freezeHeader', on)} />}
    </>
  );
}

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
          {spec.format === 'xlsx' && <SheetOptions node={node} options={options} setOption={setOption} />}
          {spec.format === 'xlsx' && <SheetRowLimit node={node} header={options.header !== false} onFormat={(format) => set({ format, options: {} })} />}
          {spec.format === 'parquet' && (
            <Field label="Compression" htmlFor="out-compression">
              <Select id="out-compression" options={PARQUET_COMPRESSION.map((c) => ({ value: c, label: COMPRESSION_LABELS[c] }))} value={String(options.compression)} onChange={(e) => setOption('compression', e.target.value)} />
            </Field>
          )}
          <ExportBlockedBanner node={node} />
          <div>
            <ExportButton node={node} size="md" />
          </div>
          <div>
            <QualityReportButton node={node} />
          </div>
        </div>
      </Section>
      <Section title="Export log" count={log.length}>
        {log.length ? (
          <ul className="flex flex-col gap-2" data-testid="export-log">
            {log.map((e) => (
              <li key={e.id} className="flex flex-col">
                <span className="text-body-strong text-ink">
                  {e.cancelled ? `${e.fileName} · stopped, nothing saved` : `${e.fileName} · ${e.rows} ${e.rows === 1 ? 'row' : 'rows'}`}
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
