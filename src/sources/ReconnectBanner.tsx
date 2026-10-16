import { useState } from 'react';
import { useProject, type Source } from '../model';
import { Banner, Button } from '../ui';
import { connectHandle, detachedMessage, filesNotKeptMessage } from './attach';
import { useAttachments } from './attachments';
import { reconnectAll, supportsFileHandles, useReconnect } from './handles';

const plural = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;
const listed = (names: string[]) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`);

/**
 * Where the browser can't keep file handles (Firefox, Safari), reconnecting with a click isn't on offer: when a
 * reopened project's files need choosing again, say why, once per project until dismissed.
 */
export function FilesNotKeptBanner({ supported = supportsFileHandles() }: { supported?: boolean }) {
  const attachments = useAttachments((s) => s.sources);
  const project = useProject();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (supported || dismissed === project.id) return null;
  const waiting = project.sources.filter((s) => s.kind === 'file' && attachments[s.id] === 'detached');
  if (!waiting.length) return null;
  return (
    <div data-testid="files-not-kept-banner">
      <Banner
        tone="info"
        title="Files aren’t kept in this browser"
        action={
          <Button size="sm" variant="ghost" onClick={() => setDismissed(project.id)}>
            Dismiss
          </Button>
        }
      >
        {filesNotKeptMessage(waiting.map((s) => s.file?.originalName ?? s.name))}
      </Banner>
    </div>
  );
}

/** Reconnect every file kept from last time, with one permission click and no file dialog (Chromium). */
export function ReconnectBanner() {
  const pending = useReconnect((s) => s.pending);
  const busy = useReconnect((s) => s.busy);
  const sources = useProject().sources;
  const waiting = sources.filter((s) => s.id in pending);
  if (!waiting.length) return null;
  const list = listed(waiting.map((s) => s.file?.originalName ?? s.name));
  return (
    <div data-testid="reconnect-banner">
      <Banner
        tone="info"
        title="Files from last time"
        action={
          <Button size="sm" variant="primary" icon="source" disabled={busy} onClick={() => void reconnectAll(connectHandle)}>
            Reconnect {plural(waiting.length)}
          </Button>
        }
      >
        Puddle can open {list} again once you allow it.
      </Banner>
    </div>
  );
}

/** Why a detached source needs its file chosen: the reason reconnecting didn't work, or the usual explanation. */
export function DetachedMessage({ source }: { source: Source }) {
  const reason = useReconnect((s) => s.reasons[source.id]);
  return <>{reason ?? detachedMessage(source)}</>;
}
