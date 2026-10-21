// The database browser: a connection's schemas, tables, views and columns as a tree in the inspector's place, with a
// search, a preview of a table's first rows, tick-to-add as sources, a query box, and a drag of a table to the canvas.
// Beekeeper Studio's sidebar is the reference; Puddle's is read-only.
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useSession } from '../app/session';
import { useProject, useProjectStore, type CatalogTable, type Connection } from '../model';
import { addConnectionSources, connectionNeeds, previewTable, readCatalog, tableName } from '../sources/connection';
import { Banner, Button, columnKind, formatValue, Icon, TextInput, TypeTag } from '../ui';
import { buildTree, countLabel, filterTree, TABLE_DRAG_TYPE, type TableDrag } from './browserTree';
import { openConnectionDialog } from './dialog';
import { driver } from './drivers';
import { useConnectionFiles } from './files';
import { useSecrets } from './secrets';

type Preview = { state: 'reading' } | { state: 'ok'; columns: string[]; rows: Record<string, unknown>[] } | { state: 'failed'; message: string };

const cellText = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function TableRow({ table, picked, open, previewing, onPick, onToggle, onPreview, drag }: { table: CatalogTable; picked: boolean; open: boolean; previewing: boolean; onPick: (on: boolean) => void; onToggle: () => void; onPreview: () => void; drag: TableDrag }) {
  const key = tableName(table);
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(TABLE_DRAG_TYPE, JSON.stringify(drag));
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <li data-testid={`browse-${key}`} data-previewing={previewing || undefined}>
      <div className={`flex items-center gap-1 px-2 ${previewing ? 'bg-surface-hover' : ''}`} draggable onDragStart={onDragStart}>
        <button type="button" className="grid h-6 w-5 shrink-0 cursor-pointer place-items-center text-ink-muted" aria-label={`${open ? 'Hide' : 'Show'} the columns of ${key}`} aria-expanded={open} onClick={onToggle}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        </button>
        <input type="checkbox" className="shrink-0 accent-brand" checked={picked} aria-label={`Add ${key}`} onChange={(e) => onPick(e.target.checked)} />
        <button type="button" className={`min-w-0 flex-1 cursor-pointer truncate py-1 text-left text-body ${previewing ? 'text-ink' : ''}`} title={`Preview the first rows of ${key}`} onClick={onPreview}>
          {table.name}
          {table.kind === 'view' && <span className="ml-1 text-label text-ink-muted">view</span>}
        </button>
        {table.rows !== undefined && <span className="ui-metric shrink-0">{table.rows.toLocaleString('en-GB')}</span>}
      </div>
      {open && (
        <ul className="mb-1 ml-9 flex flex-col" aria-label={`Columns of ${key}`}>
          {table.columns.map((c) => (
            <li key={c.name} className="flex items-center gap-2 py-0.5 text-label">
              <TypeTag type={columnKind(c.type)} />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="ui-metric truncate">{c.type.toLowerCase()}</span>
            </li>
          ))}
          {!table.columns.length && <li className="py-0.5 text-label text-ink-muted">No columns listed</li>}
        </ul>
      )}
    </li>
  );
}

function PreviewTable({ preview, name }: { preview: Preview; name: string }) {
  if (preview.state === 'reading') return <p className="px-4 py-2 text-label text-ink-muted">Reading the first rows of {name}…</p>;
  if (preview.state === 'failed')
    return (
      <div className="px-4 py-2">
        <Banner tone="fail" title={`${name} can’t be previewed`}>{preview.message}</Banner>
      </div>
    );
  return (
    <div className="min-h-0 overflow-auto" data-testid="browse-preview" data-rows={preview.rows.length}>
      <table className="w-max min-w-full border-collapse text-label">
        <thead className="sticky top-0 bg-surface-panel">
          <tr>
            {preview.columns.map((c) => (
              <th key={c} className="border-b border-line px-2 py-1 text-left font-semibold text-ink-muted">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((r, i) => (
            <tr key={i} className="border-b border-line">
              {preview.columns.map((c) => (
                <td key={c} className="max-w-64 truncate px-2 py-0.5 font-mono text-ink">{formatValue(cellText(r[c]), 'text')}</td>
              ))}
            </tr>
          ))}
          {!preview.rows.length && (
            <tr>
              <td className="px-2 py-1 text-ink-muted" colSpan={Math.max(1, preview.columns.length)}>No rows</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function BrowserBody({ connection }: { connection: Connection }) {
  const d = driver(connection.driver);
  // Subscribed so the pane follows the file being chosen and the sign-in.
  useConnectionFiles((s) => s.ids);
  useSecrets((s) => s.ids);
  const need = connectionNeeds(connection);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [previewOf, setPreviewOf] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [query, setQuery] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const readOnce = useRef(false);
  /** The table whose preview is wanted now; an older read finishing late is dropped. */
  const wanted = useRef<string | null>(null);
  const tree = useMemo(() => buildTree(connection.catalog), [connection.catalog]);
  const shown = useMemo(() => filterTree(tree, search), [tree, search]);
  const all = useMemo(() => tree.flatMap((g) => g.tables), [tree]);

  const refresh = () => {
    if (need) return;
    setReading(true);
    setError('');
    const current = useProjectStore.getState().history.present.connections.find((c) => c.id === connection.id);
    if (!current) return;
    readCatalog(current).then(
      () => setReading(false),
      (e) => (setError(e instanceof Error ? e.message : String(e)), setReading(false)),
    );
  };
  // Without a catalogue yet, read it once the tab has what the connection needs; a cached one shows at once.
  useEffect(() => {
    if (need || readOnce.current || connection.catalog) return;
    readOnce.current = true;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once when the connection becomes reachable
  }, [need, connection.catalog]);

  const showPreview = (t: CatalogTable) => {
    const key = tableName(t);
    wanted.current = key;
    setPreviewOf(key);
    setPreview({ state: 'reading' });
    previewTable(connection, { schema: t.schema, name: t.name }).then(
      (p) => wanted.current === key && setPreview({ state: 'ok', ...p }),
      (e) => wanted.current === key && setPreview({ state: 'failed', message: e instanceof Error ? e.message : String(e) }),
    );
  };
  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, key: string, on?: boolean) =>
    set((s) => {
      const next = new Set(s);
      const want = on ?? !next.has(key);
      if (want) next.add(key);
      else next.delete(key);
      return next;
    });
  const addPicked = () => {
    addConnectionSources(connection, { tables: all.filter((t) => picked.has(tableName(t))) });
    setPicked(new Set());
  };
  const addQuery = () => {
    const [s] = addConnectionSources(connection, { query });
    if (s) setQuery('');
  };
  const count = picked.size;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="database-browser" data-reading={reading || undefined}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <Icon name="database" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-strong" data-testid="browser-name">{connection.name}</div>
          <div className="truncate text-label text-ink-muted">{d.label} · {countLabel(connection.catalog)}</div>
        </div>
        <Button size="sm" variant="ghost" icon="refresh" iconOnly aria-label="Refresh the tables" disabled={reading || !!need} onClick={refresh} />
        <Button size="sm" variant="ghost" icon="text" iconOnly aria-label="Edit the connection" onClick={() => openConnectionDialog('manage', connection.id)} />
        <Button size="sm" variant="ghost" icon="cross" iconOnly aria-label="Close the database browser" onClick={() => useSession.getState().browseConnection(null)} />
      </div>
      {need === 'file' && (
        <div className="px-4 py-2">
          <Banner tone="warn" title="Choose the database file">Choose {String(connection.settings.file ?? 'the file')} again from a source that reads it, or edit the connection.</Banner>
        </div>
      )}
      {need === 'secret' && (
        <div className="px-4 py-2">
          <Banner tone="warn" title="Sign in first">Sign in from a source that reads this connection, or edit the connection.</Banner>
        </div>
      )}
      {error && (
        <div className="px-4 py-2">
          <Banner tone="fail" title="The tables couldn’t be read">{error}</Banner>
        </div>
      )}
      <div className="px-4 py-2">
        <TextInput aria-label="Search tables and columns" placeholder="Search tables and columns" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="min-h-32 flex-1 overflow-auto" role="tree" aria-label="Tables">
        {reading && !all.length && <p className="px-4 py-2 text-label text-ink-muted">Reading the database’s tables…</p>}
        {shown.map((g) => (
          <div key={g.schema ?? ''}>
            {g.schema && <h3 className="ui-eyebrow px-4 pt-2 pb-1">{g.schema}</h3>}
            <ul className="flex flex-col" aria-label={g.schema ? `Tables in ${g.schema}` : 'Tables'}>
              {g.tables.map((t) => {
                const key = tableName(t);
                return (
                  <TableRow
                    key={key}
                    table={t}
                    picked={picked.has(key)}
                    open={open.has(key)}
                    previewing={previewOf === key}
                    onPick={(on) => toggle(setPicked, key, on)}
                    onToggle={() => toggle(setOpen, key)}
                    onPreview={() => showPreview(t)}
                    drag={{ connectionId: connection.id, table: { schema: t.schema, name: t.name } }}
                  />
                );
              })}
            </ul>
          </div>
        ))}
        {!reading && all.length > 0 && !shown.length && <p className="px-4 py-2 text-label text-ink-muted">Nothing matches “{search}”.</p>}
      </div>
      {preview && previewOf && (
        <div className="flex max-h-48 shrink-0 flex-col border-t border-line">
          <div className="flex items-center gap-2 px-4 py-1">
            <span className="ui-eyebrow min-w-0 flex-1 truncate">Preview of {previewOf}</span>
            <Button size="sm" variant="ghost" icon="cross" iconOnly aria-label="Close the preview" onClick={() => ((wanted.current = null), setPreview(null), setPreviewOf(null))} />
          </div>
          <PreviewTable preview={preview} name={previewOf} />
        </div>
      )}
      <div className="flex shrink-0 flex-col gap-2 border-t border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="primary" icon="plus" disabled={!count} onClick={addPicked}>
            {count ? `Add ${count} ${count === 1 ? 'table' : 'tables'}` : 'Add tables'}
          </Button>
          <Button variant="secondary" icon="schema" disabled title="Document the schema into the project’s DBML: coming with the next change">Document the schema</Button>
        </div>
        <textarea aria-label="Query" className="ui-input is-mono min-h-[var(--size-row)] w-full resize-y py-1" rows={2} spellCheck={false} placeholder={`A query in ${d.label}’s own SQL`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div>
          <Button size="sm" variant="secondary" icon="query" disabled={!query.trim()} onClick={addQuery}>Add query</Button>
        </div>
      </div>
    </div>
  );
}

/** The pane in the inspector's place while a connection is being browsed. */
export function DatabaseBrowser({ connectionId }: { connectionId: string }) {
  const project = useProject();
  const connection = project.connections.find((c) => c.id === connectionId);
  useEffect(() => {
    if (!connection) useSession.getState().browseConnection(null);
  }, [connection]);
  if (!connection) return null;
  return <BrowserBody key={connection.id} connection={connection} />;
}
