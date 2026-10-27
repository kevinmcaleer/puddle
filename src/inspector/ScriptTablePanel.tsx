import { scriptTables } from '../compiler';
import { inputEdge, nodeById, renameNode, setScriptTable, useProject, useProjectStore, type Project, type ScriptTableNode } from '../model';
import { CommitInput } from '../steps/CommitInput';
import { Field, Select } from '../ui';

const apply = (edit: (p: Project) => Project) => useProjectStore.getState().apply(edit);

/** The inspector for a script table node: its name, and which table of the SQL node's script it holds. */
export function ScriptTablePanel({ node }: { node: ScriptTableNode }) {
  const project = useProject();
  const from = nodeById(project, inputEdge(project, node.id, 0)?.from.nodeId ?? '');
  const tables = from?.type === 'sql' ? scriptTables(from.sqlSpec.query) : [];
  const options = [...(tables.some((t) => t.toLowerCase() === node.scriptTable.table.toLowerCase()) ? [] : [{ value: node.scriptTable.table, label: node.scriptTable.table ? `${node.scriptTable.table} (no longer in the script)` : 'Choose a table' }]), ...tables.map((t) => ({ value: t, label: t }))];
  const value = tables.find((t) => t.toLowerCase() === node.scriptTable.table.toLowerCase()) ?? node.scriptTable.table;
  return (
    <div className="flex flex-col gap-2 border-b border-line px-4 py-3" data-testid="inspector-script-table">
      <Field label="Node name" htmlFor="node-name">
        <CommitInput key={node.name} id="node-name" value={node.name} onCommit={(v) => apply((p) => renameNode(p, node.id, v))} />
      </Field>
      <Field label="Table" htmlFor="script-table" hint={from?.type === 'sql' ? `A table ${from.name}’s script creates.` : 'Wire a SQL node with a script into it.'}>
        <Select id="script-table" options={options} value={value} disabled={!tables.length} onChange={(e) => apply((p) => setScriptTable(p, node.id, e.target.value))} />
      </Field>
    </div>
  );
}
