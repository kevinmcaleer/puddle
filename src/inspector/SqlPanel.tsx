import { useCallback } from 'react';
import { useSession } from '../app/session';
import { isScript, scriptTables, splitScript, sqlInputNames, sqlNodeFiles, sqlProblem, sqlTableMarks } from '../compiler';
import { useFlowStore, useNodeStatus } from '../flow/status';
import { addScriptTableNodes, inputEdges, nodeById, outputEdges, renameNode, setSqlQuery, syncScriptTables, useProject, useProjectStore, type ColumnSchema, type Project, type SqlNode } from '../model';
import { CommitInput } from '../steps/CommitInput';
import { DockedSql } from '../app/SqlDock';
import { SqlEditor } from '../steps/SqlEditor';
import { Banner, Button, Field, Section } from '../ui';
import { NodeDescription } from './NodeDescription';

/** How many file names the panel lists before "and N more". */
const LISTED = 6;

const apply = (edit: (p: Project) => Project) => useProjectStore.getState().apply(edit);

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
  const problem = inputs.length ? sqlProblem(project, node.id) : undefined;
  const script = isScript(node.sqlSpec.query);
  const files = sqlNodeFiles(project, node.id);
  const tables = scriptTables(node.sqlSpec.query);
  const split = splitScript(node.sqlSpec.query);
  // The node's rows are its last statement's: a table, or a query after the tables.
  const lastIsTable = !('problem' in split) && !!split.statements[split.statements.length - 1]?.table;
  // Each table's node, if it has one: a script table node wired from this one.
  const tableNodes = outputEdges(project, node.id).flatMap((e) => {
    const n = nodeById(project, e.to.nodeId);
    return n?.type === 'scriptTable' ? [n] : [];
  });
  const nodeOf = (table: string) => tableNodes.find((n) => n.scriptTable.table.toLowerCase() === table.toLowerCase());
  const commit = (query: string) => apply((p) => syncScriptTables(setSqlQuery(p, node.id, query), node.id, tables, scriptTables(query)));
  // Each table the query names, as it is typed: found (and which node it is) or not.
  const marks = useCallback((text: string) => sqlTableMarks(project, node.id, text), [project, node.id]);

  return (
    <div data-testid="inspector-sql">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <Field label="Node name" htmlFor="node-name">
          <CommitInput key={node.name} id="node-name" value={node.name} onCommit={(v) => apply((p) => renameNode(p, node.id, v))} />
        </Field>
        <NodeDescription node={node} />
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
          <p className="text-ink-muted">Wire a node into it: the query reads each input as input1, input2, or by its node’s name. With nothing wired in, a query that reads no input still runs, such as CREATE TABLE sizes AS SELECT * FROM (VALUES ('S'), ('M')) AS t(size).</p>
        )}
      </Section>
      {files.length > 0 && (
        <Section title="Files" count={files.length}>
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-1 font-mono text-label text-ink" data-testid="sql-files">
              {files.slice(0, LISTED).map((f) => (
                <li key={f.registered} className="truncate" title={f.name}>{f.name}</li>
              ))}
              {files.length > LISTED && <li className="text-ink-muted">and {files.length - LISTED} more</li>}
            </ul>
            <p className="text-label text-ink-muted">The files of the sources wired in, read by name or pattern: read_parquet('*.parquet', union_by_name = true), or FROM 'users.csv'.</p>
          </div>
        </Section>
      )}
      <Section title="Query">
        <div className="flex flex-col gap-2">
          <DockedSql nodeId={node.id} note={<p className="text-label text-ink-muted" data-testid="sql-docked-note">The query is beside the rows, at the bottom of the screen.</p>}>
            <SqlEditor
              key={node.id}
              id="sql-query"
              aria-label="SQL query"
              rows={10}
              value={node.sqlSpec.query}
              columns={columns}
              error={!!problem}
              placeholder={'SELECT region, sum(total) AS total\nFROM input1\nGROUP BY region'}
              onCommit={commit}
              marks={marks}
              onPoint={(mark) => useSession.getState().pointAt(mark?.nodeId ?? null)}
            />
            <p className="text-label text-ink-muted">One DuckDB query over the tables above, or a script: CREATE TABLE name AS a query, as many as you like, each reading the tables before it. Each table gets a node of its own on the canvas; this node’s rows are the last statement’s. Ctrl+Enter applies it. It can’t read other nodes, or files not wired in. A table’s name is marked when it is one of these, and underlined in red when it isn’t; point at it to see its node on the canvas.</p>
          </DockedSql>
          {problem && (
            <Banner tone="fail" title={script ? 'This script can’t run' : 'This query can’t run'}>
              {problem[0]!.toUpperCase() + problem.slice(1)}.
            </Banner>
          )}
          {!problem && status.state === 'error' && (
            <Banner tone="fail" title={script ? 'DuckDB refused the script' : 'DuckDB refused the query'}>
              {status.message}
            </Banner>
          )}
        </div>
      </Section>
      {tables.length > 0 && (
        <Section title="Tables it creates" count={tables.length}>
          <ul className="flex flex-col gap-1" data-testid="sql-script-tables">
            {tables.map((t, i) => (
              <li key={t} className="flex items-center gap-2 text-ink">
                <span className="truncate font-mono">{t}</span>
                {i === tables.length - 1 && lastIsTable && !problem && <span className="text-label text-ink-muted">this node’s rows</span>}
                <span className="ml-auto">
                  {nodeOf(t) ? (
                    <span className="text-label text-ink-muted">{nodeOf(t)!.name === t ? 'on the canvas' : `node ${nodeOf(t)!.name}`}</span>
                  ) : (
                    <Button size="sm" variant="secondary" icon="plus" onClick={() => apply((p) => addScriptTableNodes(p, node.id, [t]))}>Add node</Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
