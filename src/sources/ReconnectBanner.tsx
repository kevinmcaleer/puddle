import { useRef, useState } from 'react';
import { useProject, type Source } from '../model';
import { Banner, Button } from '../ui';
import { chooseFilesFor, connectHandle, detachedMessage, filesNotKeptMessage } from './attach';
import { ACCEPT } from './detect';
import { useAttachments } from './attachments';
import { reconnectAll, supportsFileHandles, useReconnect } from './handles';

const plural = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;
/** The files sources wait for, each once: the tables of one Access database (or sheets of one workbook) share a file. */
const fileNames = (sources: Source[]) => [...new Set(sources.map((s) => s.file?.originalName ?? s.name))];
const listed = (names: string[]) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`);

/** The one title for files a reopened project needs again, whichever way the browser gets them back. */
const FILES_FROM_LAST_TIME = 'Files from last time';

/**
 * Where the browser can't keep file handles (Firefox, Safari), reconnecting with a click isn't on offer: when a
 * reopened project's files need choosing again, say so under the same title as the one-click banner, and take every
 * missing file in one go. Shown once per project until dismissed.
 */
export function FilesNotKeptBanner({ supported = supportsFileHandles() }: { supported?: boolean }) {
  const attachments = useAttachments((s) => s.sources);
  const project = useProject();
  const input = useRef<HTMLInputElement>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (supported || dismissed === project.id) return null;
  const waiting = project.sources.filter((s) => s.kind === 'file' && attachments[s.id] === 'detached');
  if (!waiting.length) return null;
  const names = fileNames(waiting);
  return (
    <div data-testid="files-not-kept-banner">
      <Banner
        tone="info"
        title={FILES_FROM_LAST_TIME}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="primary" icon="source" onClick={() => input.current?.click()}>
              Choose {plural(names.length)}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissed(project.id)}>
              Dismiss
            </Button>
          </div>
        }
      >
        {filesNotKeptMessage(names)}
      </Banner>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        data-testid="files-not-kept-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void chooseFilesFor(waiting, files);
        }}
      />
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
  const names = fileNames(waiting);
  const list = listed(names);
  return (
    <div data-testid="reconnect-banner">
      <Banner
        tone="info"
        title={FILES_FROM_LAST_TIME}
        action={
          <Button size="sm" variant="primary" icon="source" disabled={busy} onClick={() => void reconnectAll(connectHandle)}>
            Reconnect {plural(names.length)}
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
