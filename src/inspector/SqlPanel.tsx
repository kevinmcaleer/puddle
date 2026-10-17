import { compile, customSqlErrorLine, sqlInputNames, sqlNodeProblem } from '../compiler';
import { useFlowStore, useNodeStatus } from '../flow/status';
import { inputEdges, nodeById, renameNode, setSqlQuery, useProject, useProjectStore, type ColumnSchema, type Project, type SqlNode } from '../model';
import { CommitInput } from '../steps/CommitInput';
import { ExpressionInput } from '../steps/ExpressionInput';
import { Banner, Field, Section } from '../ui';

const apply = (edit: (p: Project) => Project) => useProjectStore.getState().apply(edit);

/** Where DuckDB's error points, in the query's own line numbers. */
function errorLineOf(project: Project, node: SqlNode, message: string) {
  try {
    return customSqlErrorLine(compile(project, { nodeId: node.id }).sql, node.sqlSpec.query, message);
  } catch {
    return undefined;
  }
}

/** The inspector for a SQL node: its name, the tables its query may read, and the query itself. */
export function SqlPanel({ node }: { node: SqlNode }) {
  const project = useProject();
  const statuses = useFlowStore((s) => s.nodes);
  const status = useNodeStatus(node.id);
  const inputs = inputEdges(project, node.id)
    .map((e) => ({ port: e.to.port as number, label: nodeById(project, e.from.nodeId)?.name ?? '', fromId: e.from.nodeId }))
    .sort((a, b) => a.port - b.port);
  // Every column of every input, for the editor's suggestions.
  const seen = new Map<string, ColumnSchema>();
  for (const i of inputs) {
    const s = statuses[i.fromId]?.status;
    if (s?.state === 'ok') for (const c of s.columns) seen.set(c.name, c);
  }
  const columns = [...seen.values()];
  const problem = inputs.length ? sqlNodeProblem(node.sqlSpec, inputs) : undefined;
  const errorLine = status.state === 'error' && !problem ? errorLineOf(project, node, status.message) : undefined;

  return (
    <div data-testid="inspector-sql">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <Field label="Node name" htmlFor="node-name">
          <CommitInput key={node.name} id="node-name" value={node.name} onCommit={(v) => apply((p) => renameNode(p, node.id, v))} />
        </Field>
      </div>
      <Section title="Tables" count={inputs.length}>
        {inputs.length ? (
          <ul className="flex flex-col gap-1" data-testid="sql-tables">
            {inputs.map((i) => (
              <li key={i.port} className="flex items-center gap-2 text-ink">
                <span className="ui-metric">{i.port + 1}</span>
                <span className="truncate">{i.label}</span>
                <span className="ml-auto font-mono text-label text-ink-muted">{sqlInputNames(i, inputs.length).filter((n) => n !== i.label).join(', ')}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">Wire a node into it: the query reads each input as input1, input2, or by its node’s name.</p>
        )}
      </Section>
      <Section title="Query">
        <div className="flex flex-col gap-2">
          <ExpressionInput
            key={node.sqlSpec.query}
            id="sql-query"
            aria-label="SQL query"
            rows={10}
            value={node.sqlSpec.query}
            columns={columns}
            error={!!problem}
            placeholder={'SELECT region, sum(total) AS total\nFROM input1\nGROUP BY region'}
            onCommit={(v) => apply((p) => setSqlQuery(p, node.id, v))}
          />
          <p className="text-label text-ink-muted">One DuckDB query over the tables above. Ctrl+Enter applies it. It can’t read files or other nodes.</p>
          {problem && (
            <Banner tone="fail" title="This query can’t run">
              {problem[0]!.toUpperCase() + problem.slice(1)}.
            </Banner>
          )}
          {!problem && status.state === 'error' && (
            <Banner tone="fail" title="DuckDB refused the query">
              {status.message}
              {errorLine && <div className="mt-1 font-mono text-label">Line {errorLine.line} of the query: {errorLine.text}</div>}
            </Banner>
          )}
        </div>
      </Section>
    </div>
  );
}
