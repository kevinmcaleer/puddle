import { useRef, useState } from 'react';
import { useEngineStore } from '../app/engine';
import { compileConsole, CONSOLE_ROW_LIMIT, consoleProblem, customSqlErrorLine } from '../compiler';
import { isCancelled, tableColumns, tableRows, toEngineError } from '../engine';
import { useNodeStatus } from '../flow/status';
import { nodeById, type ColumnSchema, type Project } from '../model';
import { ExpressionInput } from '../steps/ExpressionInput';
import { Banner, Button, columnKind, TypeTag } from '../ui';
import { makeSqlNode } from './actions';
import { DEFAULT_QUERY, useConsoleDraft } from './draft';

type Answer = { nodeId: string } & (
  | { state: 'running' }
  | { state: 'ok'; columns: ColumnSchema[]; rows: Record<string, unknown>[]; ms: number }
  | { state: 'error'; message: string; line?: { line: number; text: string } }
);

/**
 * A scratch SQL console under the results table: one query against the viewed node's rows, read as `input`, with
 * the answer shown here and nothing added to the flow. One click makes it a SQL node that keeps the query.
 */
export function Console({ project }: { project: Project }) {
  const engine = useEngineStore((s) => s.engine);
  const viewedId = project.view.viewedNodeId;
  const viewed = viewedId ? nodeById(project, viewedId) : undefined;
  const status = useNodeStatus(viewedId ?? '');
  const columns = status.state === 'ok' ? status.columns : [];
  const query = useConsoleDraft((s) => s.query);
  const setQuery = useConsoleDraft((s) => s.setQuery);
  const [last, setAnswer] = useState<Answer | null>(null);
  // An answer belongs to the node it was asked of; viewing another node starts the console afresh, the query stays.
  const answer = last && last.nodeId === viewedId ? last : null;
  const runId = useRef(0);
  const problem = consoleProblem(query);

  const run = async (q: string) => {
    setQuery(q);
    if (!engine || !viewedId || consoleProblem(q)) return;
    const id = ++runId.current;
    setAnswer({ nodeId: viewedId, state: 'running' });
    let sql = '';
    try {
      sql = compileConsole(project, { nodeId: viewedId }, q);
      const t0 = performance.now();
      const r = await engine.query(sql, { label: 'Running the console query', supersede: 'console' });
      if (id !== runId.current) return;
      setAnswer({ nodeId: viewedId, state: 'ok', columns: tableColumns(r.table), rows: tableRows(r.table), ms: performance.now() - t0 });
    } catch (e) {
      if (id !== runId.current || isCancelled(e)) return;
      const err = toEngineError(e);
      setAnswer({ nodeId: viewedId, state: 'error', message: err.message, line: customSqlErrorLine(sql, q, err.detail ?? err.message) });
    }
  };

  return (
    <section className="flex min-h-0 flex-col gap-2 border-t border-line px-3 py-2" aria-label="SQL console" data-testid="sql-console">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <ExpressionInput id="console-query" aria-label="Console query" rows={3} value={query} columns={columns} error={!!problem} placeholder={DEFAULT_QUERY} onCommit={(v) => void run(v)} />
          <p className="mt-1 text-label text-ink-muted">
            {viewed ? <>Reads the rows of <strong>{viewed.name}</strong> as <code>input</code>. Ctrl+Enter runs it; the answer shows up to {CONSOLE_ROW_LIMIT} rows and changes nothing.</> : 'View a node to query its rows here.'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <Button size="sm" variant="primary" icon="code" disabled={!engine || !viewed || !!problem} onClick={() => void run(query)}>
            Run
          </Button>
          <Button size="sm" variant="secondary" icon="plus" disabled={!viewed || !!problem} title="Add a SQL node after the viewed node that keeps this query" onClick={() => viewedId && makeSqlNode(viewedId, query)}>
            Make a SQL node
          </Button>
        </div>
      </div>
      {problem && query.trim() && (
        <Banner tone="fail" title="This query can’t run">
          {problem[0]!.toUpperCase() + problem.slice(1)}.
        </Banner>
      )}
      {answer?.state === 'error' && (
        <Banner tone="fail" title="DuckDB refused the query">
          {answer.message}
          {answer.line && <div className="mt-1 font-mono text-label">Line {answer.line.line} of the query: {answer.line.text}</div>}
        </Banner>
      )}
      {answer?.state === 'running' && <p className="text-label text-ink-muted" role="status">Running…</p>}
      {answer?.state === 'ok' && <ConsoleAnswer columns={answer.columns} rows={answer.rows} ms={answer.ms} />}
    </section>
  );
}

function ConsoleAnswer({ columns, rows, ms }: { columns: ColumnSchema[]; rows: Record<string, unknown>[]; ms: number }) {
  const summary = rows.length >= CONSOLE_ROW_LIMIT ? `First ${CONSOLE_ROW_LIMIT} rows` : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`;
  return (
    <div className="min-h-0 overflow-auto" data-testid="console-answer">
      <p className="mb-1 text-label text-ink-muted" role="status" data-testid="console-summary">
        {summary} · {columns.length} {columns.length === 1 ? 'column' : 'columns'} · {Math.round(ms)} ms
      </p>
      <table className="w-full border-collapse text-body font-mono">
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
