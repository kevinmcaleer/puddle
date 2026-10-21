// Add source › From database, and Project › Databases: the project's saved connections, the driver grid for a new
// one, and the form for a connection (its settings, its secret for this tab, where it runs, and Test).
import { useEffect, useRef, useState } from 'react';
import { useSession } from '../app/session';
import { runTest } from '../connect/context';
import { useWorkspace } from '../persistence/workspace';
import { addConnection, connectionSources, removeConnection, useProject, useProjectStore, type Catalog, type CatalogTable, type Connection, type ConnectionVia, type DriverId } from '../model';
import { addConnectionSources, connectionNeeds, readCatalog, tableName } from '../sources/connection';
import { Banner, Button, Dialog, Field, formatInstant, Select, Switch, TextInput } from '../ui';
import { closeConnectionDialog, openDocumentSchema, useConnectionDialog } from './dialog';
import { describeSettings, driver, DRIVERS, fieldsFor, missingFields, SECRET_LABEL, VIA_LABEL, type Driver } from './drivers';
import { rememberConnectionFile, useConnectionFiles } from './files';
import { copyConnection, newConnection } from './form';
import { forgetSecret, rememberSecret, secretFor, SERVICE_TOKEN_ID, useSecrets } from './secrets';
import { refreshReach, useReach, type TestResult } from './service';

type View = { kind: 'list' } | { kind: 'grid' } | { kind: 'form'; connection: Connection; isNew: boolean } | { kind: 'pick'; connection: Connection };

const FILE_ACCEPT = '.sqlite,.sqlite3,.db,.db3,.s3db,.duckdb,.ddb,application/vnd.sqlite3,application/x-sqlite3';

/**
 * "Choose file" for a file driver: the file stays in this tab (src/connections/files) and the project keeps its
 * name. `id` is the connection the file is for.
 */
export function ConnectionFileButton({ id, label = 'Choose file', onChosen }: { id: string; label?: string; onChosen?: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button size="sm" variant="primary" icon="source" onClick={() => input.current?.click()}>{label}</Button>
      <input
        ref={input}
        type="file"
        accept={FILE_ACCEPT}
        hidden
        data-testid={`connection-file-${id}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          rememberConnectionFile(id, file);
          onChosen?.(file);
        }}
      />
    </>
  );
}

/** The two-letter mark a driver shows in place of a logo. */
function Monogram({ d }: { d: Driver }) {
  return (
    <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface-panel font-mono text-label text-ink-muted">
      {d.monogram}
    </span>
  );
}

function DriverGrid({ onPick }: { onPick: (id: DriverId) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2" role="list" aria-label="Databases" data-testid="driver-grid">
      {DRIVERS.map((d) => (
        <button key={d.id} type="button" role="listitem" aria-label={d.label} className="flex cursor-pointer items-center gap-2 rounded-md border border-line bg-surface-panel px-2 py-2 text-left text-ink hover:border-accent" onClick={() => onPick(d.id)}>
          <Monogram d={d} />
          <span className="min-w-0">
            <span className="block truncate text-body-strong">{d.label}</span>
            <span className="block truncate text-label text-ink-muted">{d.runsIn.includes('browser') ? 'In the browser' : 'Through puddle-connect'}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function ViaField({ d, via, onChange }: { d: Driver; via: ConnectionVia; onChange: (via: ConnectionVia) => void }) {
  const reach = useReach();
  const token = useSecrets((s) => s.ids.includes(SERVICE_TOKEN_ID));
  const [tokenText, setTokenText] = useState('');
  const status = (v: ConnectionVia) => (v === 'browser' ? '' : (v === 'local' ? reach.local : reach.pi) ? ' (found)' : reach.probed ? ' (not found)' : '');
  const options = d.runsIn.map((v) => ({ value: v, label: `${VIA_LABEL[v]}${status(v)}` }));
  const hint =
    via === 'browser'
      ? 'Read in this page. Nothing is sent to a server.'
      : via === 'local'
        ? 'puddle-connect on this computer, at localhost:8765. Start it with “npx puddle-connect”.'
        : 'puddle-connect on the Pi, behind the tunnel. Needs its token, kept in this tab only.';
  return (
    <>
      <Field label="Where it runs" htmlFor="conn-via" hint={hint}>
        <Select id="conn-via" options={options} value={via} onChange={(e) => onChange(e.target.value as ConnectionVia)} />
      </Field>
      {via === 'pi' && (
        <Field label="Service token" htmlFor="conn-service-token" hint={token ? 'A token is kept for this tab. Type another to replace it.' : 'From PUDDLE_CONNECT_TOKEN in the Pi’s .env.'}>
          <TextInput
            id="conn-service-token"
            type="password"
            mono
            autoComplete="off"
            spellCheck={false}
            value={tokenText}
            onChange={(e) => setTokenText(e.target.value)}
            onBlur={() => {
              if (tokenText.trim()) rememberSecret(SERVICE_TOKEN_ID, tokenText.trim());
              setTokenText('');
            }}
          />
        </Field>
      )}
    </>
  );
}

function ConnectionForm({ initial, isNew, onDone, onBack }: { initial: Connection; isNew: boolean; onDone: (saved: Connection) => void; onBack: () => void }) {
  const d = driver(initial.driver);
  const [conn, setConn] = useState(initial);
  const [secret, setSecret] = useState(secretFor(initial.id) ?? '');
  const [keep, setKeep] = useState(true);
  const [test, setTest] = useState<TestResult | { ok: 'testing' } | null>(null);
  const secretLabel = SECRET_LABEL[d.auth];
  const missing = missingFields(d, conn.settings, conn.via);
  const setting = (key: string, value: string | number | boolean) => {
    setConn((c) => ({ ...c, settings: { ...c.settings, [key]: value } }));
    setTest(null);
  };
  const test_ = () => {
    setTest({ ok: 'testing' });
    void runTest(conn, secret || undefined).then(setTest);
  };
  const save = () => {
    useProjectStore.getState().apply((p) => addConnection(p, conn));
    if (secret && keep) rememberSecret(conn.id, secret);
    else forgetSecret(conn.id);
    onDone(conn);
  };
  return (
    <Dialog
      title={isNew ? `New ${d.label} connection` : `Edit ${conn.name}`}
      className="w-[640px] max-w-[calc(100vw-32px)]"
      confirm="Save connection"
      confirmDisabled={missing.length > 0 || !conn.name.trim()}
      onClose={onBack}
      onConfirm={save}
    >
      <div className="flex items-center gap-2 text-label text-ink-muted">
        <Monogram d={d} />
        <span>{d.note ?? d.label}</span>
      </div>
      <Field label="Name" htmlFor="conn-name">
        <TextInput id="conn-name" data-autofocus value={conn.name} onChange={(e) => setConn({ ...conn, name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        {fieldsFor(d, conn.via).map((f) => {
          const id = `conn-${f.key}`;
          const value = conn.settings[f.key];
          if (f.kind === 'boolean')
            return (
              <div key={f.key} className="flex items-end pb-2">
                <Switch id={id} label={f.label} checked={value === true} onChange={(on) => setting(f.key, on)} />
              </div>
            );
          if (f.kind === 'file')
            return (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <div className="flex items-center gap-2">
                  <ConnectionFileButton id={conn.id} onChosen={(file) => setting(f.key, file.name)} />
                  <span className="min-w-0 truncate text-label text-ink-muted" data-testid="conn-file-name">{value ? String(value) : 'No file chosen'}</span>
                </div>
              </Field>
            );
          return (
            <Field key={f.key} label={f.label} htmlFor={id} hint={f.hint}>
              <TextInput
                id={id}
                mono={f.kind !== 'text' || f.key === 'url'}
                inputMode={f.kind === 'number' ? 'numeric' : undefined}
                spellCheck={false}
                placeholder={f.placeholder}
                value={value === undefined ? '' : String(value)}
                onChange={(e) => setting(f.key, f.kind === 'number' ? (e.target.value.trim() === '' ? '' : Number(e.target.value)) : e.target.value)}
              />
            </Field>
          );
        })}
      </div>
      {secretLabel && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={secretLabel} htmlFor="conn-secret" hint="Kept in this tab only, never in the project or its file.">
            <TextInput id="conn-secret" type="password" mono={d.auth !== 'password'} autoComplete="off" spellCheck={false} value={secret} onChange={(e) => (setSecret(e.target.value), setTest(null))} />
          </Field>
          <div className="flex items-end pb-2">
            <Switch id="conn-keep" label="Keep for this tab" checked={keep} onChange={setKeep} />
          </div>
        </div>
      )}
      {d.auth === 'oauth' && <p className="text-label text-ink-muted">Signs in with Google when the connection is first read.</p>}
      <ViaField d={d} via={conn.via} onChange={(via) => (setConn({ ...conn, via }), setTest(null))} />
      <div className="flex items-center gap-3">
        <Button variant="secondary" icon="refresh" disabled={missing.length > 0 || test?.ok === 'testing'} onClick={test_}>
          {test?.ok === 'testing' ? 'Testing…' : 'Test'}
        </Button>
        {missing.length > 0 && <span className="text-label text-ink-muted">Fill in {missing.join(', ')}.</span>}
      </div>
      {test && test.ok !== 'testing' && (
        <div data-testid="conn-test" data-ok={test.ok}>
          <Banner tone={test.ok ? 'info' : 'fail'} title={test.ok ? 'Connected' : 'Not connected'}>
            {test.detail}
          </Banner>
        </div>
      )}
    </Dialog>
  );
}

function ConnectionRow({ c, onEdit, onRemove, action }: { c: Connection; onEdit: () => void; onRemove?: () => void; action?: React.ReactNode }) {
  const d = driver(c.driver);
  const signedIn = useSecrets((s) => s.ids.includes(c.id));
  return (
    <li className="flex items-center gap-3 px-3 py-2" data-testid={`connection-${c.name}`}>
      <Monogram d={d} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-strong">{c.name}</div>
        <div className="truncate text-label text-ink-muted">
          {d.label} · {describeSettings(d, c.settings)} · {VIA_LABEL[c.via].toLowerCase()}
          {SECRET_LABEL[c.auth] ? ` · ${signedIn ? 'signed in' : 'not signed in'}` : ''}
          {c.documentedAt ? ` · documented ${formatInstant(c.documentedAt)}` : ''}
        </div>
      </div>
      {action}
      <Button size="sm" variant="ghost" icon="text" onClick={onEdit}>Edit</Button>
      {onRemove && <Button size="sm" variant="ghost" icon="cross" iconOnly aria-label={`Remove ${c.name}`} onClick={onRemove} />}
    </li>
  );
}

function ConnectionList({ mode, onNew, onEdit, onPick }: { mode: 'add' | 'manage'; onNew: () => void; onEdit: (c: Connection, isNew: boolean) => void; onPick: (c: Connection) => void }) {
  const project = useProject();
  const others = useWorkspace((s) => s.projects).filter((p) => p.id !== project.id && p.connections.length);
  const [notice, setNotice] = useState<string | null>(null);
  const remove = (c: Connection) => {
    const used = connectionSources(project, c.id).length;
    if (used) {
      setNotice(`${c.name} is read by ${used} ${used === 1 ? 'source' : 'sources'}. Remove those first.`);
      return;
    }
    useProjectStore.getState().apply((p) => removeConnection(p, c.id));
    forgetSecret(c.id);
  };
  return (
    <Dialog title={mode === 'add' ? 'Add source from a database' : 'Databases'} className="w-[640px] max-w-[calc(100vw-32px)]" onClose={closeConnectionDialog}>
      <p className="text-label text-ink-muted">Connections are saved in the project without their secret. Secrets stay in this tab.</p>
      {notice && <Banner tone="warn">{notice}</Banner>}
      {project.connections.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface-panel" aria-label="Connections">
          {project.connections.map((c) => (
            <ConnectionRow
              key={c.id}
              c={c}
              onEdit={() => onEdit(c, false)}
              onRemove={() => remove(c)}
              action={
                <>
                  <Button size="sm" variant="ghost" icon="search" onClick={() => (closeConnectionDialog(), useSession.getState().browseConnection(c.id))}>Browse</Button>
                  {mode === 'manage' && <Button size="sm" variant="ghost" icon="schema" onClick={() => openDocumentSchema(c.id)}>Document</Button>}
                  {mode === 'add' && <Button size="sm" variant="secondary" icon="database" onClick={() => onPick(c)}>Choose tables</Button>}
                </>
              }
            />
          ))}
        </ul>
      ) : (
        <Banner tone="info" title="No connections yet">Pick a database below to make one.</Banner>
      )}
      {others.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="ui-eyebrow">From other projects</h3>
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface-panel" aria-label="Connections in other projects">
            {others.flatMap((p) =>
              p.connections.map((c) => (
                <li key={`${p.id}-${c.id}`} className="flex items-center gap-3 px-3 py-2">
                  <Monogram d={driver(c.driver)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body-strong">{c.name}</div>
                    <div className="truncate text-label text-ink-muted">{driver(c.driver).label} · in {p.name}</div>
                  </div>
                  <Button size="sm" variant="ghost" icon="append" onClick={() => onEdit(copyConnection(project, c), true)}>Copy here</Button>
                </li>
              )),
            )}
          </ul>
        </div>
      )}
      <div>
        <Button variant="primary" icon="plus" onClick={onNew}>New connection</Button>
      </div>
    </Dialog>
  );
}

/** "n rows" from a catalogue estimate, or nothing. */
const rowsLabel = (t: CatalogTable) => (t.rows === undefined ? '' : `${t.rows.toLocaleString('en-GB')} ${t.rows === 1 ? 'row' : 'rows'}`);

/**
 * Choosing what to read from a connection: its tables (ticked), or a query in the database's own dialect, each
 * becoming a source. The catalogue is read when the picker opens (and kept on the connection), once the tab has
 * what the connection needs: its file, or its secret.
 */
function TablePicker({ connectionId, onBack }: { connectionId: string; onBack: () => void }) {
  const project = useProject();
  const connection = project.connections.find((c) => c.id === connectionId);
  const d = connection && driver(connection.driver);
  // Subscribed so the picker follows the file being chosen and the sign-in.
  useConnectionFiles((s) => s.ids);
  useSecrets((s) => s.ids);
  const need = connection && connectionNeeds(connection);
  const needsFile = need === 'file';
  const needsSecret = need === 'secret';
  const [secret, setSecret] = useState('');
  const [catalog, setCatalog] = useState<Catalog | undefined>(connection?.catalog);
  const [state, setState] = useState<'idle' | 'ok' | 'failed'>('idle');
  const [attempt, setAttempt] = useState(0);
  const tried = useRef(-1);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState('');
  const ready = !!connection && !needsFile && !needsSecret;
  useEffect(() => {
    if (!ready || tried.current === attempt) return;
    tried.current = attempt;
    // The connection is read from the store here, not closed over: reading the catalogue amends it, which must not restart the read.
    const current = useProjectStore.getState().history.present.connections.find((c) => c.id === connectionId);
    if (!current) return;
    readCatalog(current).then(
      (c) => (setCatalog(c), setState('ok')),
      (e) => (setError(e instanceof Error ? e.message : String(e)), setState('failed')),
    );
  }, [ready, attempt, connectionId]);
  if (!connection || !d) return null;
  const tables = catalog?.tables ?? [];
  const toggle = (key: string, on: boolean) =>
    setPicked((p) => {
      const next = new Set(p);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const count = picked.size + (query.trim() ? 1 : 0);
  const add = () => {
    const n = limit.trim() === '' ? undefined : Math.max(1, Math.floor(Number(limit)));
    const added = addConnectionSources(connection, { tables: tables.filter((t) => picked.has(tableName(t))), query, limit: n && Number.isFinite(n) ? n : undefined });
    const node = useProjectStore.getState().history.present.nodes.find((x) => x.type === 'source' && x.sourceId === added[0]?.id);
    if (node) useSession.getState().select(node.id);
    closeConnectionDialog();
  };
  return (
    <Dialog title={`Read from ${connection.name}`} className="w-[640px] max-w-[calc(100vw-32px)]" confirm={count ? `Add ${count} ${count === 1 ? 'source' : 'sources'}` : 'Add sources'} confirmDisabled={!count} onConfirm={add} onClose={onBack}>
      <div className="flex items-center gap-2 text-label text-ink-muted">
        <Monogram d={d} />
        <span>{d.label} · {describeSettings(d, connection.settings)}</span>
      </div>
      {needsFile && (
        <Banner tone="info" title="Choose the database file" action={<ConnectionFileButton id={connection.id} />}>
          Files stay on this computer: choose {String(connection.settings.file ?? 'the file')} again in this tab.
        </Banner>
      )}
      {needsSecret && !needsFile && (
        <div className="flex items-end gap-2">
          <Field label={SECRET_LABEL[d.auth]} htmlFor="pick-secret" hint="Kept in this tab only.">
            <TextInput id="pick-secret" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </Field>
          <div className="pb-5">
            <Button variant="primary" disabled={!secret} onClick={() => rememberSecret(connection.id, secret)}>Sign in</Button>
          </div>
        </div>
      )}
      {ready && state === 'idle' && <p className="text-label text-ink-muted">Reading the database’s tables…</p>}
      {state === 'failed' && (
        <Banner tone="fail" title="The tables couldn’t be read" action={<Button size="sm" variant="secondary" icon="refresh" onClick={() => (setState('idle'), setAttempt((n) => n + 1))}>Try again</Button>}>
          {error}
        </Banner>
      )}
      {tables.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="ui-eyebrow">Tables</h3>
          <div className="max-h-64 overflow-y-auto rounded-md border border-line bg-surface-panel" data-testid="table-picker">
            {tables.map((t) => {
              const key = tableName(t);
              return (
                <label key={key} className="ui-check" data-testid={`pick-${key}`}>
                  <input type="checkbox" checked={picked.has(key)} aria-label={key} onChange={(e) => toggle(key, e.target.checked)} />
                  <span className="min-w-0 flex-1 truncate">{key}{t.kind === 'view' ? ' (view)' : ''}</span>
                  <span className="text-label text-ink-muted">{t.columns.length} {t.columns.length === 1 ? 'column' : 'columns'}{rowsLabel(t) ? ` · ${rowsLabel(t)}` : ''}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
      {state === 'ok' && tables.length === 0 && <Banner tone="info" title="No tables">This database has no tables to read. A query can still be run below.</Banner>}
      {ready && (
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label="Or a query" htmlFor="pick-query" hint={`Runs in the database, in ${d.label}’s own SQL. Becomes a source of its own.`}>
            <textarea id="pick-query" className="ui-input is-mono min-h-[var(--size-row)] w-full resize-y py-1" rows={3} spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} />
          </Field>
          <Field label="At most" htmlFor="pick-limit" hint="rows per source; empty reads all">
            <TextInput id="pick-limit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

function ConnectionsDialogBody({ mode, editId, pickId }: { mode: 'add' | 'manage'; editId?: string; pickId?: string }) {
  const project = useProject();
  const editing = editId ? project.connections.find((c) => c.id === editId) : undefined;
  const picking = pickId ? project.connections.find((c) => c.id === pickId) : undefined;
  const [view, setView] = useState<View>(editing ? { kind: 'form', connection: editing, isNew: false } : picking ? { kind: 'pick', connection: picking } : { kind: 'list' });
  useEffect(() => void refreshReach(), []);
  if (view.kind === 'grid') {
    return (
      <Dialog title="New connection" className="w-[640px] max-w-[calc(100vw-32px)]" onClose={() => setView({ kind: 'list' })}>
        <p className="text-label text-ink-muted">Database files and services that let a browser in are read in the browser; the rest go through puddle-connect on this computer or the Pi.</p>
        <DriverGrid onPick={(id) => setView({ kind: 'form', connection: newConnection(project, id, useReach.getState()), isNew: true })} />
      </Dialog>
    );
  }
  if (view.kind === 'form')
    return (
      <ConnectionForm
        key={view.connection.id}
        initial={view.connection}
        isNew={view.isNew}
        onDone={(saved) => (editing ? closeConnectionDialog() : mode === 'add' ? setView({ kind: 'pick', connection: saved }) : setView({ kind: 'list' }))}
        onBack={() => (editing ? closeConnectionDialog() : setView(view.isNew ? { kind: 'grid' } : { kind: 'list' }))}
      />
    );
  if (view.kind === 'pick') return <TablePicker key={view.connection.id} connectionId={view.connection.id} onBack={() => setView({ kind: 'list' })} />;
  return <ConnectionList mode={mode} onNew={() => setView({ kind: 'grid' })} onEdit={(connection, isNew) => setView({ kind: 'form', connection, isNew })} onPick={(connection) => setView({ kind: 'pick', connection })} />;
}

/** Add source › From database and Project › Databases. */
export function ConnectionDialog() {
  const { mode, editId, pickId } = useConnectionDialog();
  return mode ? <ConnectionsDialogBody key={`${mode}-${editId ?? ''}-${pickId ?? ''}`} mode={mode} editId={editId} pickId={pickId} /> : null;
}
