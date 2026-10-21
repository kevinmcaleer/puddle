// Add source › From database, and Project › Databases: the project's saved connections, the driver grid for a new
// one, and the form for a connection (its settings, its secret for this tab, where it runs, and Test).
import { useEffect, useState } from 'react';
import { useWorkspace } from '../persistence/workspace';
import { addConnection, connectionSources, removeConnection, useProject, useProjectStore, type Connection, type ConnectionVia, type DriverId } from '../model';
import { Banner, Button, Dialog, Field, Select, Switch, TextInput } from '../ui';
import { closeConnectionDialog, useConnectionDialog } from './dialog';
import { describeSettings, driver, DRIVERS, missingFields, SECRET_LABEL, VIA_LABEL, type Driver } from './drivers';
import { copyConnection, newConnection } from './form';
import { forgetSecret, rememberSecret, secretFor, SERVICE_TOKEN_ID, useSecrets } from './secrets';
import { refreshReach, testConnection, useReach, type TestResult } from './service';

type View = { kind: 'list' } | { kind: 'grid' } | { kind: 'form'; connection: Connection; isNew: boolean };

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

function ConnectionForm({ initial, isNew, onDone, onBack }: { initial: Connection; isNew: boolean; onDone: () => void; onBack: () => void }) {
  const d = driver(initial.driver);
  const [conn, setConn] = useState(initial);
  const [secret, setSecret] = useState(secretFor(initial.id) ?? '');
  const [keep, setKeep] = useState(true);
  const [test, setTest] = useState<TestResult | { ok: 'testing' } | null>(null);
  const secretLabel = SECRET_LABEL[d.auth];
  const missing = missingFields(d, conn.settings);
  const setting = (key: string, value: string | number | boolean) => {
    setConn((c) => ({ ...c, settings: { ...c.settings, [key]: value } }));
    setTest(null);
  };
  const runTest = () => {
    setTest({ ok: 'testing' });
    void testConnection(conn, secret || undefined).then(setTest);
  };
  const save = () => {
    useProjectStore.getState().apply((p) => addConnection(p, conn));
    if (secret && keep) rememberSecret(conn.id, secret);
    else forgetSecret(conn.id);
    onDone();
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
        {d.fields.map((f) => {
          const id = `conn-${f.key}`;
          const value = conn.settings[f.key];
          if (f.kind === 'boolean')
            return (
              <div key={f.key} className="flex items-end pb-2">
                <Switch id={id} label={f.label} checked={value === true} onChange={(on) => setting(f.key, on)} />
              </div>
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
        <Button variant="secondary" icon="refresh" disabled={missing.length > 0 || test?.ok === 'testing'} onClick={runTest}>
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
        </div>
      </div>
      {action}
      <Button size="sm" variant="ghost" icon="text" onClick={onEdit}>Edit</Button>
      {onRemove && <Button size="sm" variant="ghost" icon="cross" iconOnly aria-label={`Remove ${c.name}`} onClick={onRemove} />}
    </li>
  );
}

function ConnectionList({ mode, onNew, onEdit }: { mode: 'add' | 'manage'; onNew: () => void; onEdit: (c: Connection, isNew: boolean) => void }) {
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
            <ConnectionRow key={c.id} c={c} onEdit={() => onEdit(c, false)} onRemove={() => remove(c)} />
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

function ConnectionsDialogBody({ mode, editId }: { mode: 'add' | 'manage'; editId?: string }) {
  const project = useProject();
  const editing = editId ? project.connections.find((c) => c.id === editId) : undefined;
  const [view, setView] = useState<View>(editing ? { kind: 'form', connection: editing, isNew: false } : { kind: 'list' });
  useEffect(() => void refreshReach(), []);
  if (view.kind === 'grid') {
    return (
      <Dialog title="New connection" className="w-[640px] max-w-[calc(100vw-32px)]" onClose={() => setView({ kind: 'list' })}>
        <p className="text-label text-ink-muted">Database files and services that let a browser in are read in the browser; the rest go through puddle-connect on this computer or the Pi.</p>
        <DriverGrid onPick={(id) => setView({ kind: 'form', connection: newConnection(project, id, useReach.getState()), isNew: true })} />
      </Dialog>
    );
  }
  if (view.kind === 'form') return <ConnectionForm key={view.connection.id} initial={view.connection} isNew={view.isNew} onDone={() => (editing ? closeConnectionDialog() : setView({ kind: 'list' }))} onBack={() => (editing ? closeConnectionDialog() : setView(view.isNew ? { kind: 'grid' } : { kind: 'list' }))} />;
  return <ConnectionList mode={mode} onNew={() => setView({ kind: 'grid' })} onEdit={(connection, isNew) => setView({ kind: 'form', connection, isNew })} />;
}

/** Add source › From database and Project › Databases. */
export function ConnectionDialog() {
  const { mode, editId } = useConnectionDialog();
  return mode ? <ConnectionsDialogBody key={`${mode}-${editId ?? ''}`} mode={mode} editId={editId} /> : null;
}
