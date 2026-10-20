// The Format picker: for a file the sniff couldn't settle, choose what it is and how to read it. The source is on the
// canvas already, read as the best guess, so the choice re-reads it in place.
import { useState } from 'react';
import { useProject, type ParseOptions, type SourceFormat } from '../model';
import { Dialog, Field, Select } from '../ui';
import { changeSourceFormat } from './add';
import { CsvOptions } from './CsvOptions';
import { closeFormatDialog, useFormatDialog } from './formatDialog';
import { FORMAT_OPTIONS } from './formats';


function FormatForm({ sourceId, reason }: { sourceId: string; reason?: string }) {
  const source = useProject().sources.find((s) => s.id === sourceId);
  const [format, setFormat] = useState<SourceFormat>(source?.format ?? 'csv');
  const [options, setOptions] = useState<ParseOptions>(source?.parseOptions ?? {});
  const [busy, setBusy] = useState(false);
  if (!source) return null;
  const submit = () => {
    if (busy) return;
    setBusy(true);
    changeSourceFormat(sourceId, format, format === 'csv' || format === 'tsv' ? options : {}).finally(() => {
      setBusy(false);
      closeFormatDialog();
    });
  };
  return (
    <Dialog title={`How should ${source.name} be read?`} confirm={busy ? 'Reading…' : 'Read it this way'} onClose={closeFormatDialog} onConfirm={submit}>
      <div data-testid="format-dialog" className="flex flex-col gap-3">
        {reason && <p className="text-label text-ink-muted">{reason}</p>}
        <Field label="Format" htmlFor="format-pick">
          <Select id="format-pick" data-autofocus options={FORMAT_OPTIONS} value={format} onChange={(e) => setFormat(e.target.value as SourceFormat)} />
        </Field>
        {(format === 'csv' || format === 'tsv') && <CsvOptions format={format} options={options} onChange={setOptions} idPrefix="format" />}
      </div>
    </Dialog>
  );
}

export function FormatDialog() {
  const { sourceId, reason } = useFormatDialog();
  if (!sourceId) return null;
  return <FormatForm key={sourceId} sourceId={sourceId} reason={reason} />;
}
