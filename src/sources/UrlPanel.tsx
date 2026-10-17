import { useState } from 'react';
import type { Source } from '../model';
import { Banner, Button, Field, Section, TextInput } from '../ui';
import { useAttachments } from './attachments';
import { CorsHint } from './UrlDialog';
import type { Credentials } from './odata';
import { rememberSignIn } from './odataSignIn';
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
            {fetch.kind === 'cors' && !source.url?.odata && <Button size="sm" variant="secondary" icon="export" onClick={() => openAddress(href)}>Download</Button>}
          </div>
        }
      >
        {problem.message}
      </Banner>
      {fetch.kind === 'cors' && !source.url?.odata && <CorsHint />}
    </div>
  );
}

/** Sign in to an OData source's service again (sign-ins stay in the tab they were typed in), then read it. */
function ODataSignIn({ source, kind }: { source: Source; kind: 'basic' | 'bearer' }) {
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const signIn = () => {
    const credentials: Credentials = kind === 'basic' ? { kind, user, password } : { kind, token: token.trim() };
    rememberSignIn(source.id, credentials);
    void loadUrlSource(source, { refresh: true });
  };
  return (
    <form
      className="flex flex-col gap-3"
      data-testid="odata-sign-in"
      onSubmit={(e) => {
        e.preventDefault();
        signIn();
      }}
    >
      {kind === 'basic' ? (
        <>
          <Field label="User name" htmlFor={`odata-user-${source.id}`}>
            <TextInput id={`odata-user-${source.id}`} autoComplete="username" spellCheck={false} value={user} onChange={(e) => setUser(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor={`odata-password-${source.id}`}>
            <TextInput id={`odata-password-${source.id}`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </>
      ) : (
        <Field label="Token" htmlFor={`odata-token-${source.id}`}>
          <TextInput id={`odata-token-${source.id}`} type="password" mono autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} />
        </Field>
      )}
      <div>
        <Button size="sm" variant="primary" type="submit">Sign in and read</Button>
      </div>
    </form>
  );
}

/** What an OData source reads: its entity set and query options. */
function ODataDetails({ odata }: { odata: NonNullable<NonNullable<Source['url']>['odata']> }) {
  const lines: [string, string][] = [['Entity set', odata.entitySet]];
  if (odata.select?.length) lines.push(['Columns', odata.select.join(', ')]);
  if (odata.filter) lines.push(['Filter', odata.filter]);
  if (odata.top) lines.push(['Rows', `at most ${odata.top}`]);
  if (odata.auth) lines.push(['Sign-in', `${odata.auth === 'basic' ? 'Basic' : 'Bearer token'}, kept in this tab only`]);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label" data-testid="odata-details">
      {lines.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="break-all text-ink">{v}</dd>
        </div>
      ))}
    </dl>
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
      title={source.url?.sample ? 'Sample data' : source.url?.odata ? 'OData feed' : source.url?.table ? 'Web page' : 'Web address'}
      action={
        <Button size="sm" variant="ghost" icon="refresh" disabled={busy} onClick={() => void loadUrlSource(source, { refresh: true })}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3" data-testid="url-panel" data-state={fetch?.state ?? 'none'} data-attachment={state}>
        <div className="break-all font-mono text-label text-ink" data-testid="url-address">{href}</div>
        {source.url?.table && <div className="text-label text-ink" data-testid="url-table">Table: {source.url.table.label}</div>}
        <div className="text-label text-ink-muted" data-testid="url-fetched">
          {fetch?.state === 'ok' ? `Fetched at ${time(fetch.at)}${fetch.ranged ? ', read in parts as needed' : ''}` : busy ? 'Fetching…' : 'Not fetched yet'}
        </div>
        {source.url?.odata && <ODataDetails odata={source.url.odata} />}
        {fetch?.state === 'failed' && <UrlProblemBanner source={source} />}
        {fetch?.state === 'failed' && fetch.kind === 'auth' && source.url?.odata?.auth && <ODataSignIn source={source} kind={source.url.odata.auth} />}
        {state === 'mismatch' && fetch?.state === 'ok' && (
          <Banner tone="warn" title={source.url?.odata ? 'This feed has changed' : 'This file has changed'}>
            {source.url?.odata
              ? 'Its rows don’t match what this project last read from the service. The steps have re-run on them; check the results.'
              : 'Its first megabyte doesn’t match what this project last read from the address. The steps have re-run on it; check the results.'}
          </Banner>
        )}
      </div>
    </Section>
  );
}
