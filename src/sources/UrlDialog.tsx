import { useState } from 'react';
import { addUrl } from '../app/actions';
import { formatLabel } from '../canvas/formatLabel';
import type { SourceFormat } from '../model';
import { Banner, Button, Dialog, Field, Select, TextInput } from '../ui';
import { openAddress, UrlSourceError, type UrlErrorKind } from './url';
import { openUrlDialog, useUrlDialog } from './urlDialog';

const FORMATS: SourceFormat[] = ['csv', 'tsv', 'json', 'ndjson', 'parquet', 'xml'];
const FORMAT_OPTIONS = [{ value: '', label: 'Detect from the address' }, ...FORMATS.map((f) => ({ value: f, label: formatLabel(f) }))];

/** Why a blocked address can't be read, with the way round it: download the file and add it as a file. */
export function CorsHint() {
  return (
    <p className="text-ink-muted" data-testid="cors-hint">
      Puddle reads web addresses straight from your browser and never sends data through a server of its own, so the server has to allow it (CORS).
    </p>
  );
}

function UrlForm({ onChooseFile }: { onChooseFile: () => void }) {
  const [address, setAddress] = useState('');
  const [format, setFormat] = useState<SourceFormat | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ kind: UrlErrorKind | 'other'; message: string } | null>(null);
  const close = () => openUrlDialog(false);

  const submit = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    addUrl(address, format || undefined).then(close, (e: unknown) => {
      setBusy(false);
      setError({ kind: e instanceof UrlSourceError ? e.kind : 'other', message: e instanceof Error ? e.message : String(e) });
    });
  };

  return (
    <Dialog title="Add source from a web address" confirm={busy ? 'Reading…' : 'Add source'} onClose={close} onConfirm={submit}>
      <Field label="Address" htmlFor="url-address" hint="An https address of a CSV, TSV, JSON, NDJSON or Parquet file.">
        <TextInput
          id="url-address"
          mono
          data-autofocus
          inputMode="url"
          spellCheck={false}
          placeholder="https://example.org/orders.csv"
          value={address}
          error={!!error && error.kind === 'address'}
          onChange={(e) => setAddress(e.target.value)}
        />
      </Field>
      <Field label="Format" htmlFor="url-format">
        <Select id="url-format" options={FORMAT_OPTIONS} value={format} onChange={(e) => setFormat(e.target.value as SourceFormat | '')} />
      </Field>
      {error && (
        <div data-testid="url-error" data-kind={error.kind}>
          <Banner
            tone="fail"
            title={error.kind === 'cors' ? 'The server blocked this' : 'This address can’t be read'}
            action={
              error.kind === 'cors' ? (
                <div className="flex flex-col gap-2">
                  <Button size="sm" variant="secondary" icon="export" onClick={() => openAddress(address.trim())}>Download</Button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon="source"
                    onClick={() => {
                      close();
                      onChooseFile();
                    }}
                  >
                    Choose file
                  </Button>
                </div>
              ) : undefined
            }
          >
            {error.message}
          </Banner>
          {error.kind === 'cors' && <CorsHint />}
        </div>
      )}
    </Dialog>
  );
}

/** Add source › From URL. */
export function UrlDialog({ onChooseFile }: { onChooseFile: () => void }) {
  const open = useUrlDialog((s) => s.open);
  return open ? <UrlForm onChooseFile={onChooseFile} /> : null;
}
