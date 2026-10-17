import type { Source } from '../model';
import { Banner, Button, Section } from '../ui';
import { useAttachments } from './attachments';
import { CorsHint } from './UrlDialog';
import { addressOf, loadUrlSource, openAddress, urlProblem, useUrlFetches } from './url';

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** What went wrong reading a URL source, with Download and Try again; shared by the inspector and the results. */
export function UrlProblemBanner({ source }: { source: Source }) {
  const fetch = useUrlFetches((s) => s.fetches[source.id]);
  const href = String(addressOf(source));
  const problem = urlProblem(fetch, href);
  if (fetch?.state !== 'failed') return <Banner tone="info" title={problem.title}>{problem.message}</Banner>;
  return (
    <div className="flex flex-col gap-2">
      <Banner
        tone="fail"
        title={problem.title}
        action={
          <div className="flex flex-col gap-2">
            <Button size="sm" variant="primary" icon="refresh" onClick={() => void loadUrlSource(source)}>Try again</Button>
            {fetch.kind === 'cors' && <Button size="sm" variant="secondary" icon="export" onClick={() => openAddress(href)}>Download</Button>}
          </div>
        }
      >
        {problem.message}
      </Banner>
      {fetch.kind === 'cors' && <CorsHint />}
    </div>
  );
}

/** The inspector's view of a URL source: its address, when it was last fetched, Refresh, and any problem. */
export function UrlPanel({ source }: { source: Source }) {
  const fetch = useUrlFetches((s) => s.fetches[source.id]);
  const state = useAttachments((s) => s.sources[source.id] ?? 'detached');
  const href = String(addressOf(source));
  const busy = fetch?.state === 'fetching';
  return (
    <Section
      title={source.url?.sample ? 'Sample data' : 'Web address'}
      action={
        <Button size="sm" variant="ghost" icon="refresh" disabled={busy} onClick={() => void loadUrlSource(source, { refresh: true })}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3" data-testid="url-panel" data-state={fetch?.state ?? 'none'} data-attachment={state}>
        <div className="break-all font-mono text-label text-ink" data-testid="url-address">{href}</div>
        <div className="text-label text-ink-muted" data-testid="url-fetched">
          {fetch?.state === 'ok' ? `Fetched at ${time(fetch.at)}${fetch.ranged ? ', read in parts as needed' : ''}` : busy ? 'Fetching…' : 'Not fetched yet'}
        </div>
        {fetch?.state === 'failed' && <UrlProblemBanner source={source} />}
        {state === 'mismatch' && fetch?.state === 'ok' && (
          <Banner tone="warn" title="This file has changed">
            Its first megabyte doesn’t match what this project last read from the address. The steps have re-run on it; check the results.
          </Banner>
        )}
      </div>
    </Section>
  );
}
