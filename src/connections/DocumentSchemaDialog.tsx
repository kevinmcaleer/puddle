// Document the schema: what a connection's database says about itself, written into the project's DBML as a group
// named after the connection. Shows what will be written (or what changed since the last time), then does it in one
// undo step that also saves a version.
import { useEffect, useState } from 'react';
import { useProject, useProjectStore, type Connection } from '../model';
import type { SchemaChange } from '../schema/diff';
import { connectionNeeds } from '../sources/connection';
import { Banner, Dialog, formatInstant } from '../ui';
import { closeDocumentSchema, useConnectionDialog } from './dialog';
import { applyDocument, planDocument, readSchemaDetail, type DocumentPlan } from './document';
import { driver } from './drivers';

type State = { kind: 'reading' } | { kind: 'failed'; message: string } | { kind: 'ready'; plan: DocumentPlan; at: Date };

const ACTION_CLASS: Record<SchemaChange['action'], string> = { add: 'is-added', remove: 'is-removed', change: 'is-changed' };

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

function Body({ connection, tables }: { connection: Connection; tables?: string[] }) {
  const project = useProject();
  const [state, setState] = useState<State>({ kind: 'reading' });
  const need = connectionNeeds(connection);
  useEffect(() => {
    if (need) return;
    let live = true;
    readSchemaDetail(connection).then(
      (detail) => {
        if (!live) return;
        const at = new Date();
        setState({ kind: 'ready', plan: planDocument(useProjectStore.getState().history.present, connection, detail, at, tables), at });
      },
      (e) => live && setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per opening
  }, [connection.id, need]);

  const confirm = () => {
    if (state.kind !== 'ready') return;
    applyDocument(connection, state.plan, state.at);
    closeDocumentSchema();
  };
  const ready = state.kind === 'ready';
  const plan = ready ? state.plan : null;
  const changes = plan?.diff?.changes ?? [];
  const d = driver(connection.driver);
  return (
    <Dialog title="Document the schema" confirm="Document" confirmDisabled={!ready || !plan?.generated.tables.length} onClose={closeDocumentSchema} onConfirm={confirm} className="w-[560px] max-w-[calc(100vw-32px)]">
      <p className="text-label text-ink-muted">
        The tables, keys, indexes, foreign keys and views of {connection.name} ({d.label}) are written into the project’s schema as the table group “{connection.name}”, replacing what that group held before. Your own tables and notes stay as they are, and a version is saved first.
      </p>
      {need === 'file' && <Banner tone="warn" title="Choose the database file">Choose {String(connection.settings.file ?? 'the file')} again from a source that reads it, or edit the connection.</Banner>}
      {need === 'secret' && <Banner tone="warn" title="Sign in first">Sign in from a source that reads this connection, or edit the connection.</Banner>}
      {state.kind === 'reading' && !need && <p className="text-label text-ink-muted">Reading the schema…</p>}
      {state.kind === 'failed' && <Banner tone="fail" title="The schema couldn’t be read">{state.message}</Banner>}
      {plan && (
        <div className="flex flex-col gap-2" data-testid="document-plan">
          <p className="text-body">
            {count(plan.generated.tables.length, 'table')}, {count(plan.generated.refs.length, 'ref')} and {count(plan.generated.enums.length, 'enum')}
            {plan.schema ? ` in the schema ${plan.schema}, as a table of the same name is in the project already` : ''}.
          </p>
          {!plan.generated.tables.length && <Banner tone="info">Nothing to document: the database has no tables.</Banner>}
          {plan.before && connection.documentedAt && (
            <p className="text-label text-ink-muted">
              Last documented {formatInstant(connection.documentedAt)}. {changes.length ? `${count(changes.length, 'change')} since:` : 'Nothing has changed since.'}
            </p>
          )}
          {changes.length > 0 && (
            <ul className="puddle-schema-changes max-h-64 overflow-auto text-label" aria-label="Changes since last documented">
              {changes.map((c, i) => (
                <li key={i} className={ACTION_CLASS[c.action]}>{c.text}</li>
              ))}
            </ul>
          )}
          {project.sources.some((s) => s.kind === 'connection' && s.connection?.connectionId === connection.id && s.connection.table) && (
            <p className="text-label text-ink-muted">Sources reading these tables are checked against them: the keys, not nulls and foreign keys become their rules.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}

export function DocumentSchemaDialog() {
  const { documentId, documentTables } = useConnectionDialog();
  const project = useProject();
  const connection = documentId ? project.connections.find((c) => c.id === documentId) : undefined;
  if (!connection) return null;
  return <Body key={`${connection.id}:${documentTables?.join(',') ?? '*'}`} connection={connection} tables={documentTables} />;
}
