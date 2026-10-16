import { useSession } from '../app/session';
import { QUERY_JOIN_TYPES } from '../compiler';
import { useFlowStore } from '../flow/status';
import { removeQueryJoin, renameNode, setQueryJoinKind, useProject, useProjectStore, type Project, type QueryJoinKind, type QueryNode } from '../model';
import { designerTables, useDesigner } from '../query/tables';
import { CommitInput } from '../steps/CommitInput';
import { Button, cx, Field, Section, Select } from '../ui';

const apply = (edit: (p: Project) => Project) => useProjectStore.getState().apply(edit);

/** The inspector for a Query node: a way into the designer, its tables, and its join lines with how each matches rows. */
export function QueryPanel({ node }: { node: QueryNode }) {
  const project = useProject();
  const statuses = useFlowStore((s) => s.nodes);
  const designing = useSession((s) => s.designerNodeId === node.id);
  const selectedJoin = useDesigner((s) => s.selectedJoinId);
  const tables = designerTables(project, node, statuses);
  const label = (port: number) => tables.find((t) => t.port === port)?.label ?? `input ${port + 1}`;
  const { joins, fields } = node.querySpec;

  return (
    <div data-testid="inspector-query">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <Field label="Node name" htmlFor="node-name">
          <CommitInput key={node.name} id="node-name" value={node.name} onCommit={(v) => apply((p) => renameNode(p, node.id, v))} />
        </Field>
        {!designing && (
          <Button variant="primary" icon="query" onClick={() => useSession.getState().openDesigner(node.id)}>
            Open query designer
          </Button>
        )}
      </div>
      <Section title="Tables" count={tables.length}>
        {tables.length ? (
          <ol className="flex flex-col gap-1" data-testid="query-tables-list">
            {tables.map((t) => (
              <li key={t.port} className="flex items-center gap-2">
                <span className="ui-metric">{t.port + 1}</span>
                <span className="truncate text-ink">{t.label}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-ink-muted">Wire nodes into the numbered inputs, or add tables in the query designer.</p>
        )}
      </Section>
      <Section title="Joins" count={joins.length}>
        {joins.length ? (
          <ul className="flex flex-col gap-3" data-testid="query-joins">
            {joins.map((j, i) => (
              <li key={j.id} className={cx('flex flex-col gap-1 rounded-sm', selectedJoin === j.id && 'bg-surface-hover')} data-testid="query-join" onClick={() => useDesigner.getState().selectJoin(j.id)}>
                <div className="flex items-center gap-1">
                  <span className="ui-col min-w-0 flex-1 truncate" title={`${label(j.left.port)}.${j.left.column} = ${label(j.right.port)}.${j.right.column}`}>
                    {label(j.left.port)}.{j.left.column} = {label(j.right.port)}.{j.right.column}
                  </span>
                  <Button variant="ghost" size="sm" icon="cross" iconOnly aria-label={`Remove join ${i + 1}`} onClick={() => apply((p) => removeQueryJoin(p, node.id, j.id))} />
                </div>
                <Select
                  aria-label={`Join ${i + 1} keeps`}
                  options={Object.entries(QUERY_JOIN_TYPES).map(([value, t]) => ({ value, label: t.label }))}
                  value={j.kind}
                  onChange={(e) => apply((p) => setQueryJoinKind(p, node.id, j.id, e.target.value as QueryJoinKind))}
                />
                <span className="text-label text-ink-muted">{QUERY_JOIN_TYPES[j.kind].hint(label(j.left.port), label(j.right.port))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">In the designer, drag a field of one table onto the matching field of another, such as a customer’s id onto the order’s customer id.</p>
        )}
      </Section>
      {!designing && fields.length > 0 && (
        <Section title="Fields" count={fields.length}>
          <p className="text-ink-muted">{fields.map((f) => (f.column === '*' ? `${label(f.port)}.*` : f.alias?.trim() || f.column)).join(', ')}</p>
        </Section>
      )}
    </div>
  );
}
