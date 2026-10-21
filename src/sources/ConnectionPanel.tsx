import { useState } from 'react';
import { ConnectionFileButton } from '../connections/ConnectionDialog';
import { openConnectionDialog } from '../connections/dialog';
import { driver, SECRET_LABEL } from '../connections/drivers';
import { useConnectionFiles } from '../connections/files';
import { rememberSecret, useSecrets } from '../connections/secrets';
import { updateConnectionSource, useProject, useProjectStore, type ConnectionSource, type Source } from '../model';
import { Banner, Button, Field, formatInstant, Section, Select, TextInput } from '../ui';
import { connectionNeeds, connectionOf, readsLabel, refreshConnectionSource, tableName, useConnectionReads } from './connection';

/** Why a connection source's rows can't be shown yet: being read, what it still needs, or what went wrong. Shared by the inspector and the results. */
export function ConnectionProblemBanner({ source }: { source: Source & { connection: ConnectionSource } }) {
  const project = useProject();
  const connection = connectionOf(project, source);
  const read = useConnectionReads((s) => s.reads[source.id]);
  // Subscribed so the banner follows the file being chosen and the sign-in.
  useConnectionFiles((s) => s.ids);
  useSecrets((s) => s.ids);
  if (!connection) return <Banner tone="fail" title="Its connection is gone">The connection this source read through was removed from the project.</Banner>;
  const d = driver(connection.driver);
  const need = connectionNeeds(connection);
  if (need === 'file')
    return (
      <Banner tone="warn" title="Choose the database file" action={<ConnectionFileButton id={connection.id} />}>
        Files stay on this computer: choose {String(connection.settings.file ?? 'the file')} again to read {readsLabel(source.connection)}.
      </Banner>
    );
  if (need === 'secret') return <SignIn connectionId={connection.id} label={SECRET_LABEL[d.auth]!} />;
  if (read?.state === 'failed') return <Banner tone="fail" title="This source can’t be read">{read.message}</Banner>;
  return <Banner tone="info" title={`Reading from ${connection.name}`}>The rows are being read through the connection.</Banner>;
}

function SignIn({ connectionId, label }: { connectionId: string; label: string }) {
  const [secret, setSecret] = useState('');
  return (
    <Banner tone="warn" title="Sign in to read this source">
      <div className="flex items-end gap-2">
        <Field label={label} htmlFor="source-secret" hint="Kept in this tab only.">
          <TextInput id="source-secret" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </Field>
        <div className="pb-5">
          <Button size="sm" variant="primary" disabled={!secret} onClick={() => rememberSecret(connectionId, secret)}>Sign in</Button>
        </div>
      </div>
    </Banner>
  );
}

/** The inspector's options for a connection source: which table or query it reads, how many rows, and reading it again. */
export function ConnectionPanel({ source }: { source: Source & { connection: ConnectionSource } }) {
  const apply = useProjectStore((s) => s.apply);
  const project = useProject();
  const connection = connectionOf(project, source);
  const read = useConnectionReads((s) => s.reads[source.id]);
  const c = source.connection;
  const [query, setQuery] = useState(c.query ?? '');
  const [limit, setLimit] = useState(c.limit === undefined ? '' : String(c.limit));
  const tables = connection?.catalog?.tables ?? [];
  const current = c.table ? tableName(c.table) : '';
  const options = tables.map((t) => ({ value: tableName(t), label: tableName(t) }));
  if (current && !options.some((o) => o.value === current)) options.unshift({ value: current, label: current });
  const commitLimit = () => {
    const n = limit.trim() === '' ? undefined : Math.max(1, Math.floor(Number(limit)));
    const next = n !== undefined && Number.isFinite(n) ? n : undefined;
    if (next !== c.limit) apply((p) => updateConnectionSource(p, source.id, { limit: next }));
  };
  return (
    <Section title="Database">
      <div className="flex flex-col gap-3" data-testid="connection-panel" data-state={read?.state ?? 'none'}>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-body-strong">{connection ? `${connection.name} (${driver(connection.driver).label})` : 'Connection removed'}</span>
          {connection && <Button size="sm" variant="ghost" icon="text" onClick={() => openConnectionDialog('manage', connection.id)}>Edit</Button>}
        </div>
        {c.table ? (
          <Field label="Table" htmlFor="opt-conn-table">
            <Select
              id="opt-conn-table"
              options={options}
              value={current}
              disabled={!tables.length}
              onChange={(e) => {
                const t = tables.find((x) => tableName(x) === e.target.value);
                if (t) apply((p) => updateConnectionSource(p, source.id, { table: { schema: t.schema, name: t.name }, columns: t.columns.map((col) => ({ name: col.name, type: col.type })) }));
              }}
            />
          </Field>
        ) : (
          <Field label="Query" htmlFor="opt-conn-query" hint="Runs in the database, in its own SQL. Saved when the field loses focus.">
            <textarea
              id="opt-conn-query"
              className="ui-input is-mono min-h-[var(--size-row)] w-full resize-y py-1"
              rows={4}
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => query.trim() !== (c.query ?? '') && query.trim() && apply((p) => updateConnectionSource(p, source.id, { query: query.trim() }))}
            />
          </Field>
        )}
        <div className="grid grid-cols-2 items-end gap-3">
          <Field label="At most" htmlFor="opt-conn-limit" hint="rows; empty reads all">
            <TextInput id="opt-conn-limit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} onBlur={commitLimit} onKeyDown={(e) => e.key === 'Enter' && commitLimit()} />
          </Field>
          <div className="pb-5">
            <Button size="sm" variant="secondary" icon="refresh" disabled={read?.state === 'reading'} onClick={() => refreshConnectionSource(source.id)}>Refresh</Button>
          </div>
        </div>
        {read?.state === 'ok' && (
          <p className="text-label text-ink-muted" data-testid="connection-read">
            {read.rows.toLocaleString('en-GB')} {read.rows === 1 ? 'row' : 'rows'} read at {formatInstant(new Date(read.at).toISOString(), true)}
          </p>
        )}
        {read?.state !== 'ok' && <ConnectionProblemBanner source={source} />}
      </div>
    </Section>
  );
}
