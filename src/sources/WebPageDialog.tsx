import { useState, type ClipboardEvent } from 'react';
import { addPastedTable, addWebTable } from '../app/actions';
import { Banner, Button, Dialog, Field, Select, TextInput } from '../ui';
import { findTables, likeliestTable, parseHtml, tableSize, type HtmlTable } from './html';
import { UrlSourceError, type UrlErrorKind } from './url';
import { tablesAt, type PageRoute } from './webpage';
import { openWebPageDialog, useWebPageDialog } from './webPageDialog';

const PREVIEW_ROWS = 5;

/** The first few rows of a table, so the right one is easy to pick. */
export function TablePreview({ table }: { table: HtmlTable }) {
  return (
    <div className="max-h-48 overflow-auto rounded-sm border border-line" data-testid="web-table-preview">
      <table className="ui-grid w-full text-label">
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={i} className="bg-surface-sunken px-2 text-left font-semibold">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ROUTE_NOTE: Record<PageRoute, string> = {
  direct: 'Read straight from the site.',
  wikipedia: 'Read through Wikipedia’s own API.',
};

type Found = { url?: URL; route?: PageRoute; tables: HtmlTable[] };

function WebPageForm() {
  const [mode, setMode] = useState<'address' | 'paste'>('address');
  const [address, setAddress] = useState('');
  const [pasted, setPasted] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [chosen, setChosen] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ kind: UrlErrorKind | 'other'; message: string } | null>(null);
  const close = () => openWebPageDialog(false);
  const fail = (e: unknown) => {
    setBusy(false);
    setError({ kind: e instanceof UrlSourceError ? e.kind : 'other', message: e instanceof Error ? e.message : String(e) });
  };
  const show = (f: Found) => {
    setFound(f);
    setChosen(likeliestTable(f.tables)?.index ?? 0);
    setBusy(false);
  };

  const readPasted = (html: string) => {
    setError(null);
    const tables = html.trim() ? findTables(parseHtml(html)) : [];
    if (tables.length) show({ tables });
    else {
      setFound(null);
      if (html.trim()) setError({ kind: 'format', message: 'There’s no table in what you pasted. Select the whole table on the page, copy it, and paste it here.' });
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    // A table copied from a page comes with its HTML; the text alone loses where its cells start and end.
    const html = e.clipboardData.getData('text/html');
    if (!html) return;
    e.preventDefault();
    setPasted(html);
    readPasted(html);
  };

  const table = found?.tables[chosen];
  const submit = () => {
    if (busy) return;
    setError(null);
    if (table) {
      setBusy(true);
      (found?.url ? addWebTable(found.url, table) : addPastedTable(table)).then(close, fail);
    } else if (mode === 'address') {
      setBusy(true);
      tablesAt(address).then(show, fail);
    } else readPasted(pasted);
  };

  const switchTo = (next: 'address' | 'paste') => {
    setMode(next);
    setFound(null);
    setError(null);
  };

  return (
    <Dialog
      title="Add source from a web page"
      className="w-[640px] max-w-[calc(100vw-32px)]"
      confirm={busy ? 'Reading…' : table ? 'Add source' : 'Find tables'}
      onClose={close}
      onConfirm={submit}
    >
      {mode === 'address' ? (
        <Field label="Address" htmlFor="web-address" hint="An https address of a page with a table on it, such as a Wikipedia list.">
          <TextInput
            id="web-address"
            mono
            data-autofocus
            inputMode="url"
            spellCheck={false}
            placeholder="https://en.wikipedia.org/wiki/List_of_James_Bond_films"
            value={address}
            error={!!error && error.kind === 'address'}
            onChange={(e) => {
              setAddress(e.target.value);
              setFound(null);
            }}
          />
        </Field>
      ) : (
        <Field label="Pasted table" htmlFor="web-paste" hint="Select the table on the page, copy it, and paste it here. The page’s HTML source works too.">
          <textarea
            id="web-paste"
            data-autofocus
            className="ui-input min-h-[var(--size-grid-header)] w-full resize-y py-1 font-mono"
            rows={3}
            spellCheck={false}
            value={pasted}
            onPaste={onPaste}
            onChange={(e) => {
              setPasted(e.target.value);
              setFound(null);
            }}
          />
        </Field>
      )}
      <div>
        <button type="button" className="ui-link" onClick={() => switchTo(mode === 'address' ? 'paste' : 'address')}>
          {mode === 'address' ? 'Paste a copied table instead' : 'Read from an address instead'}
        </button>
      </div>
      {found && table && (
        <div className="flex flex-col gap-2" data-testid="web-tables">
          <Field
            label={found.tables.length === 1 ? 'Table' : `Table (${found.tables.length} on this page)`}
            htmlFor="web-table"
            hint={`${tableSize(table)}.${found.route ? ` ${ROUTE_NOTE[found.route]}` : ''}`}
          >
            <Select
              id="web-table"
              options={found.tables.map((t) => ({ value: String(t.index), label: `${t.label} (${tableSize(t)})` }))}
              value={String(chosen)}
              onChange={(e) => setChosen(Number(e.target.value))}
            />
          </Field>
          <TablePreview table={table} />
        </div>
      )}
      {error && (
        <div data-testid="web-error" data-kind={error.kind}>
          <Banner
            tone="fail"
            title={error.kind === 'cors' ? 'The site blocked this' : mode === 'paste' ? 'No table found' : 'This page can’t be read'}
            action={
              error.kind === 'cors' ? (
                <Button size="sm" variant="primary" icon="paste" onClick={() => switchTo('paste')}>Paste instead</Button>
              ) : undefined
            }
          >
            {error.message}
          </Banner>
        </div>
      )}
    </Dialog>
  );
}

/** Add source › From web page. */
export function WebPageDialog() {
  const open = useWebPageDialog((s) => s.open);
  return open ? <WebPageForm /> : null;
}
