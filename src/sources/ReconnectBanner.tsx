import { useProject, type Source } from '../model';
import { Banner, Button } from '../ui';
import { connectHandle, detachedMessage } from './attach';
import { reconnectAll, useReconnect } from './handles';

const plural = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;

/** Reconnect every file kept from last time, with one permission click and no file dialog (Chromium). */
export function ReconnectBanner() {
  const pending = useReconnect((s) => s.pending);
  const busy = useReconnect((s) => s.busy);
  const sources = useProject().sources;
  const waiting = sources.filter((s) => s.id in pending);
  if (!waiting.length) return null;
  const names = waiting.map((s) => s.file?.originalName ?? s.name);
  const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
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
