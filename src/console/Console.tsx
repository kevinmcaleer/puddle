import { useEffect, useRef } from 'react';
import { useEngineStore } from '../app/engine';
import { isScript, readShellCommand, scriptTables, shellCommandProblem, shellNames, SHELL_ROW_LIMIT } from '../compiler';
import { useNodeStatus } from '../flow/status';
import { nodeById, type ColumnSchema, type Project } from '../model';
import { SqlEditor } from '../steps/SqlEditor';
import { announce, Banner, Button, columnKind, TypeTag } from '../ui';
import { keepAsSqlNode, runShellCommand, viewTable } from './shell';
import { DEFAULT_QUERY, useConsoleDraft, type ShellEntry, type ShellOutput } from './draft';
import './console.css';

/**
 * The DuckDB shell under the results table: commands typed as in DuckDB's shell, each answered in the shell's
 * history above the prompt. Every node is a table by its name, the viewed node is `input` too, and a statement that
 * makes or changes a table keeps it in a SQL node, so the table is a node on the canvas.
 */
export function Console({ project }: { project: Project }) {
  const engine = useEngineStore((s) => s.engine);
  const viewedId = project.view.viewedNodeId;
  const viewed = viewedId ? nodeById(project, viewedId) : undefined;
  const status = useNodeStatus(viewedId ?? '');
  const columns = status.state === 'ok' ? status.columns : [];
  const query = useConsoleDraft((s) => s.query);
  const setQuery = useConsoleDraft((s) => s.setQuery);
  const entries = useConsoleDraft((s) => s.entries);
  const history = useConsoleDraft((s) => s.history);
  const names = shellNames(project, viewedId);
  const problem = query.trim() ? shellCommandProblem(query, names) : undefined;
  const statements = readShellCommand(query);
  const script = isScript(query) && statements.every((s) => s.kind === 'change' || s.kind === 'query');
  const creates = script ? scriptTables(query) : [];
  const single = statements.length === 1 && statements[0]!.kind === 'query';
  // Where the up and down arrows are in the history: null at the prompt, with what was being typed kept.
  const recall = useRef<{ at: number; draft: string } | null>(null);
  const log = useRef<HTMLDivElement>(null);

  // The newest answer is in view.
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const run = (command: string) => {
    setQuery(command);
    recall.current = null;
    if (!engine || shellCommandProblem(command, shellNames(project, viewedId))) return;
    void runShellCommand(engine, command, viewedId).then((said) => said && announce(said));
  };

  const onHistory = (direction: 'up' | 'down', text: string): string | undefined => {
    if (!history.length) return undefined;
    const now = recall.current ?? { at: history.length, draft: text };
    const at = direction === 'up' ? Math.max(0, now.at - 1) : now.at + 1;
    if (at >= history.length) {
      if (recall.current == null) return undefined;
      recall.current = null;
      return now.draft;
    }
    if (direction === 'up' && now.at === 0) return undefined;
    recall.current = { at, draft: now.draft };
    return history[at];
  };

  // The answer to the last command is the shell's answer; earlier ones are its history.
  const last = entries[entries.length - 1];
  const latestRows = last && (last.output.kind === 'rows' || last.output.kind === 'table') ? last.id : undefined;

  return (
    <section className="puddle-shell flex min-h-0 flex-col gap-2 border-t border-line px-3 py-2" aria-label="SQL console" data-testid="sql-console">
      {entries.length > 0 && (
        <div ref={log} className="flex min-h-0 shrink flex-col gap-3 overflow-auto" role="log" aria-label="Shell history" data-testid="shell-transcript">
          {entries.map((e) => (
            <ShellEntryView key={e.id} entry={e} latest={e.id === latestRows} />
          ))}
        </div>
      )}
      <div className="flex shrink-0 items-start gap-2">
        <div
          className="min-w-0 flex-1"
          onKeyDownCapture={(e) => {
            // Ctrl+L clears the shell, as in a terminal.
            if (e.key.toLowerCase() === 'l' && e.ctrlKey && !e.altKey && !e.metaKey) {
              e.preventDefault();
              useConsoleDraft.getState().clear();
            }
          }}
        >
          <SqlEditor
            id="console-query"
            aria-label="Console query"
            rows={3}
            value={query}
            columns={columns}
            error={!!problem}
            placeholder={DEFAULT_QUERY}
            onCommit={setQuery}
            onSubmit={run}
            onHistory={onHistory}
          />
          <p className="mt-1 text-label text-ink-muted">
            {viewed ? (
              <>
                Reads the rows of <strong>{viewed.name}</strong> as <code>input</code>, and every node by its name.{' '}
              </>
            ) : (
              'Reads every node by its name. '
            )}
            Ctrl+Enter runs DuckDB SQL, up and down bring back earlier commands; .help lists the rest. CREATE TABLE, INSERT, UPDATE and DELETE keep their tables on the canvas.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {script && creates.length > 0 && statements.every((s) => s.kind === 'change') && statements.every((s) => /^\s*create\b/i.test(s.text)) ? (
            <Button size="sm" variant="primary" icon="plus" disabled={!engine || !!problem} title="Run the script: its tables go into a SQL node, each with a node of its own on the canvas" onClick={() => run(query)}>
              {creates.length === 1 ? 'Create table' : 'Create tables'}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="primary" icon="code" disabled={!engine || !query.trim() || !!problem} onClick={() => run(query)}>
                Run
              </Button>
              <Button size="sm" variant="secondary" icon="plus" disabled={!viewed || !single || !!problem} title="Add a SQL node after the viewed node that keeps this query" onClick={() => viewedId && keepAsSqlNode(viewedId, query)}>
                Make a SQL node
              </Button>
            </>
          )}
        </div>
      </div>
      {problem && (
        <Banner tone="fail" title={script ? 'This script can’t run' : 'This query can’t run'}>
          {problem[0]!.toUpperCase() + problem.slice(1)}.
        </Banner>
      )}
    </section>
  );
}

function ShellEntryView({ entry, latest }: { entry: ShellEntry; latest: boolean }) {
  return (
    <div className="ui-selectable flex flex-col gap-1" data-testid="shell-entry">
      <pre className="puddle-shell-command font-mono text-body text-ink">
        <span className="text-ink-muted" aria-hidden="true">
          D{' '}
        </span>
        {entry.command}
      </pre>
      {entry.input && <p className="text-label text-ink-muted">input was {entry.input}</p>}
      <ShellOutputView output={entry.output} latest={latest} />
    </div>
  );
}

function ShellOutputView({ output, latest }: { output: ShellOutput; latest: boolean }) {
  switch (output.kind) {
    case 'running':
      return (
        <p className="text-label text-ink-muted" role="status">
          Running…
        </p>
      );
    case 'error':
      return (
        <Banner tone="fail" title={output.title}>
          {output.message}
          {output.line && <div className="mt-1 font-mono text-label">Line {output.line.line} of the query: {output.line.text}</div>}
        </Banner>
      );
    case 'text':
      return output.code ? <pre className="font-mono text-body text-ink whitespace-pre-wrap">{output.text}</pre> : <p className="text-body text-ink whitespace-pre-wrap">{output.text}</p>;
    case 'kept':
      return (
        <p className="text-label text-ink-muted">
          Kept as{' '}
          <button type="button" className="ui-link" onClick={() => viewTable(output.nodeId)}>
            {output.name}
          </button>
          : its rows are in the table above.
        </p>
      );
    case 'tables':
      return output.tables.length ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1" data-testid="shell-tables">
          {output.tables.map((t) => (
            <li key={t.nodeId} className="flex items-baseline gap-1">
              <button type="button" className="ui-link font-mono" title={`View ${t.name} in the table above`} onClick={() => viewTable(t.nodeId)}>
                {t.name}
              </button>
              <span className="text-label text-ink-muted">
                {t.type}
                {t.columns != null ? ` · ${t.columns} ${t.columns === 1 ? 'column' : 'columns'}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-label text-ink-muted">No tables match.</p>
      );
    case 'table':
      return (
        <div className="flex flex-col gap-1">
          <p className="text-body text-ink" data-testid="shell-changed">
            {output.message}
            {output.nodeId && (
              <>
                {' '}
                <button type="button" className="ui-link" onClick={() => viewTable(output.nodeId!)}>
                  View on the canvas
                </button>
              </>
            )}
          </p>
          {output.columns && output.rows && <RowsView columns={output.columns} rows={output.rows} latest={latest} />}
        </div>
      );
    case 'rows':
      return <RowsView columns={output.columns} rows={output.rows} ms={output.ms} latest={latest} />;
  }
}

function RowsView({ columns, rows, ms, latest }: { columns: ColumnSchema[]; rows: Record<string, unknown>[]; ms?: number; latest: boolean }) {
  const summary = rows.length >= SHELL_ROW_LIMIT ? `First ${SHELL_ROW_LIMIT} rows` : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`;
  return (
    <div className="ui-selectable min-h-0 overflow-auto" data-testid={latest ? 'console-answer' : 'shell-answer'}>
      <p className="mb-1 text-label text-ink-muted" role={latest ? 'status' : undefined} data-testid={latest ? 'console-summary' : undefined}>
        {summary} · {columns.length} {columns.length === 1 ? 'column' : 'columns'}
        {ms != null ? ` · ${Math.round(ms)} ms` : ''}
      </p>
      <table className="border-collapse text-body font-mono">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.name} scope="col" className="sticky top-0 border-b border-line bg-surface-panel px-2 py-1 text-left text-label font-medium text-ink-muted">
                <span className="inline-flex items-center gap-1">
                  <TypeTag type={columnKind(c.type)} />
                  {c.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line">
              {columns.map((c) => (
                <td key={c.name} className="whitespace-nowrap px-2 py-0.5 text-ink">
                  {row[c.name] == null ? <span className="text-ink-muted">null</span> : String(row[c.name])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

