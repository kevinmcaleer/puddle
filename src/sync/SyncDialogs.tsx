import { useEffect, useState } from 'react';
import { useProject } from '../model';
import { Banner, Button, Dialog, Field, TextInput } from '../ui';
import { PROVIDERS, sync, useSync, type ProviderId, type RemoteFile } from '.';
import { openSyncDialog, syncTime, useSyncDialog } from './dialogs';

const close = () => openSyncDialog(null);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Where to make a token, and what it may do. */
const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

function TokenField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error: string | null }) {
  return (
    <Field
      label="Personal access token"
      htmlFor="sync-token"
      error={error}
      hint={
        <>
          A{' '}
          <a href={TOKEN_URL} target="_blank" rel="noreferrer" className="text-accent-ink underline">
            fine-grained token
          </a>{' '}
          with the Gists account permission set to read and write, and nothing else. It is kept in this browser only and
          removed when you disconnect.
        </>
      }
    >
      <TextInput id="sync-token" type="password" mono autoComplete="off" spellCheck={false} value={value} error={!!error} autoFocus onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function ProjectSyncDialog({ provider }: { provider: ProviderId }) {
  const project = useProject();
  const account = useSync((s) => s.accounts[provider]);
  const linked = useSync((s) => s.provider === provider);
  const status = useSync((s) => s.status);
  const error = useSync((s) => s.error);
  const [token, setToken] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = PROVIDERS[provider].label;

  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (!account) await sync.connect(provider, token);
      await sync.link(provider);
      close();
    } catch (e) {
      setProblem(message(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        void sync.disconnect(provider);
        close();
      }}
    >
      Disconnect GitHub
    </Button>
  );

  if (linked)
    return (
      <Dialog title={`Sync to ${label}`} onClose={close}>
        <p className="text-ink-muted">
          {project.name} syncs to a secret Gist on {account ? `@${account}’s` : 'your'} GitHub account after each change.
          Disconnecting removes the token from this browser and stops syncing here; your Gists stay on GitHub.
        </p>
        {status === 'error' && error && <Banner tone="fail" title="Sync failed">{error}</Banner>}
        {status === 'error' && (
          // A refused or expired token: a new one carries on with the same Gist.
          <div className="flex flex-col gap-2">
            <TokenField value={token} onChange={setToken} error={problem} />
            <div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setProblem(null);
                  sync.connect(provider, token).then(close, (e: unknown) => setProblem(message(e)));
                }}
              >
                Use this token
              </Button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              void sync.unlink();
              close();
            }}
          >
            Stop syncing this project
          </Button>
          {disconnect}
        </div>
      </Dialog>
    );

  return (
    <Dialog title={`Sync to ${label}`} confirm={busy ? 'Connecting' : account ? 'Sync this project' : 'Connect and sync'} onClose={close} onConfirm={() => void start()}>
      <p className="text-ink-muted">
        Keep this project in a secret Gist so it follows you to other browsers. Only the project file syncs: steps, notes
        and settings. Your data, and any pasted rows, stay in this browser.
      </p>
      {account ? (
        <div className="flex items-center justify-between gap-2">
          <span data-testid="sync-account">Connected as @{account}</span>
          {disconnect}
        </div>
      ) : (
        <TokenField value={token} onChange={setToken} error={problem} />
      )}
      {account && problem && <Banner tone="fail">{problem}</Banner>}
    </Dialog>
  );
}

function OpenRemoteDialog({ provider }: { provider: ProviderId }) {
  const account = useSync((s) => s.accounts[provider]);
  const [token, setToken] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [files, setFiles] = useState<RemoteFile[] | null>(null);
  const label = PROVIDERS[provider].label;

  useEffect(() => {
    if (!account) return;
    let live = true;
    sync.list(provider).then(
      (f) => live && setFiles(f),
      (e: unknown) => live && setProblem(message(e)),
    );
    return () => {
      live = false;
    };
  }, [account, provider]);

  const open = async (id: string) => {
    try {
      await sync.openRemote(provider, id);
      close();
    } catch (e) {
      setProblem(message(e));
    }
  };

  if (!account)
    return (
      <Dialog
        title={`Open from ${label}`}
        confirm="Connect"
        onClose={close}
        onConfirm={() => {
          setProblem(null);
          sync.connect(provider, token).catch((e: unknown) => setProblem(message(e)));
        }}
      >
        <p className="text-ink-muted">Connect to GitHub to list the Puddle projects in your Gists.</p>
        <TokenField value={token} onChange={setToken} error={problem} />
      </Dialog>
    );

  return (
    <Dialog title={`Open from ${label}`} onClose={close}>
      {problem && <Banner tone="fail" title="That didn’t work">{problem}</Banner>}
      {!files && !problem && <p className="text-ink-muted">Looking for Puddle projects in @{account}’s Gists…</p>}
      {files?.length === 0 && <Banner title="No synced projects yet">Open a project and choose Sync to {label} from its menu.</Banner>}
      {!!files?.length && (
        <ul className="flex max-h-[50vh] flex-col divide-y divide-line overflow-auto rounded-md border border-line bg-surface-panel" aria-label="Synced projects">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2" data-testid={`remote-${f.title}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-body-strong">{f.title}</div>
                <div className="text-label text-ink-muted">Updated {syncTime(f.updatedAt)}</div>
              </div>
              <Button size="sm" onClick={() => void open(f.id)}>
                Open
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/** The sync dialogs, shared by the home screen and the editor. */
export function SyncDialogs() {
  const dialog = useSyncDialog((s) => s.dialog);
  if (!dialog) return null;
  return dialog.kind === 'project' ? <ProjectSyncDialog provider={dialog.provider} /> : <OpenRemoteDialog provider={dialog.provider} />;
}

/** A conflict waits for the user: both versions' times, and the three ways out. Nothing merges silently. */
export function SyncConflictBanner() {
  const conflict = useSync((s) => (s.status === 'conflict' ? s.conflict : null));
  const provider = useSync((s) => s.provider);
  if (!conflict || !provider) return null;
  const label = PROVIDERS[provider].label;
  return (
    <div className="border-b border-line px-3 py-2" data-testid="sync-conflict">
      <Banner
        tone="warn"
        title="This project changed in another browser too"
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void sync.resolve('mine')}>Keep mine</Button>
            <Button size="sm" onClick={() => void sync.resolve('remote')}>Take remote</Button>
            <Button size="sm" variant="ghost" onClick={() => void sync.resolve('copy')}>Save mine as a copy</Button>
          </div>
        }
      >
        <div>
          This browser’s version was saved <span data-testid="sync-local-time">{syncTime(conflict.localAt)}</span>; the {label} version{' '}
          <span data-testid="sync-remote-time">{syncTime(conflict.remoteAt)}</span>. Nothing is overwritten until you choose.
        </div>
      </Banner>
    </div>
  );
}
