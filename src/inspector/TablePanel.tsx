import { loadColumns, LOAD_FAILURES, projectSchema } from '../compiler';
import { qualified } from '../schema';
import { useFlowStore, useNodeStatus } from '../flow/status';
import { inputEdges, renameNode, setTableSpec, useProject, useProjectStore, type Project, type SchemaTableNode } from '../model';
import { showFailing } from '../rules/view';
import { tableNotes, useSchemaTables } from '../schemaTables/state';
import { useSession } from '../app/session';
import { CommitInput } from '../steps/CommitInput';
import { Banner, Button, Field, Section, Select, Switch } from '../ui';

const apply = (edit: (p: Project) => Project) => useProjectStore.getState().apply(edit);

/** The value a mapping select shows for a column: matched by name, an input column, or its default. */
const AUTO = '\u0000auto';
const DEFAULT = '\u0000default';

/**
 * The inspector for a Schema table node: which of the schema's tables it holds, whether its example records count, how
 * the rows wired into it fill each column, and why any of them can't load.
 */
export function TablePanel({ node }: { node: SchemaTableNode }) {
  const project = useProject();
  const status = useNodeStatus(node.id);
  const statuses = useFlowStore((s) => s.nodes);
  const built = useSchemaTables((s) => s.built);
  const schema = projectSchema(project.schema.dbml);
  const spec = node.tableSpec;
  const table = schema.tables.find((t) => t.schema === spec.schema && t.name === spec.table);
  const input = inputEdges(project, node.id)[0];
  const inputStatus = input ? statuses[input.from.nodeId]?.status : undefined;
  const inputColumns = inputStatus?.state === 'ok' ? inputStatus.columns.map((c) => c.name) : undefined;
  const mapped = table && inputColumns ? loadColumns(schema, table, spec, inputColumns) : [];
  const notes = tableNotes(node, built);
  const update = (patch: Partial<SchemaTableNode['tableSpec']>) => apply((p) => setTableSpec(p, node.id, patch));
  const options = schema.tables.map((t) => ({ value: `${t.schema}\u0000${t.name}`, label: qualified(t.schema, t.name) }));

  return (
    <div data-testid="inspector-table">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <Field label="Node name" htmlFor="node-name">
          <CommitInput key={node.name} id="node-name" value={node.name} onCommit={(v) => apply((p) => renameNode(p, node.id, v))} />
        </Field>
        <Field label="Table" htmlFor="table-pick">
          <Select
            id="table-pick"
            options={table ? options : [{ value: '', label: spec.table ? `${spec.table} (not in the schema)` : 'Choose a table' }, ...options]}
            value={table ? `${table.schema}\u0000${table.name}` : ''}
            onChange={(e) => {
              const [s, t] = e.target.value.split('\u0000');
              if (t) update({ schema: s!, table: t });
            }}
          />
        </Field>
        {!schema.tables.length && (
          <p className="text-ink-muted">
            The schema has no tables yet.{' '}
            <Button size="sm" variant="ghost" onClick={() => useSession.getState().setSchemaOpen(true)}>
              Design them
            </Button>
          </p>
        )}
        <Switch id="table-examples" label="Include example records" checked={spec.examples} onChange={(on) => update({ examples: on })} />
      </div>
      {status.state === 'error' && status.failures && (
        <div className="border-b border-line px-4 py-3" data-testid="table-failures">
          <Banner
            tone="fail"
            title="Some rows can’t load"
            action={
              <Button size="sm" variant="secondary" onClick={() => showFailing(node.id, LOAD_FAILURES)}>
                Show failing rows
              </Button>
            }
          >
            <ul className="flex flex-col gap-1">
              {status.failures.map((f) => (
                <li key={f}>{f}.</li>
              ))}
            </ul>
          </Banner>
        </div>
      )}
      {notes.length > 0 && (
        <div className="border-b border-line px-4 py-3">
          <Banner tone="warn" title="Built with changes">
            <ul className="flex flex-col gap-1">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Banner>
        </div>
      )}
      <Section title="Load" count={mapped.length || undefined}>
        {!input ? (
          <p className="text-ink-muted">Wire a node into it to load its rows. Each row is checked against the table’s keys, types and checks first.</p>
        ) : !table || !inputColumns ? (
          <p className="text-ink-muted">The columns can be matched once the table and its input are both ready.</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="table-mapping">
            {mapped.map((m) => {
              const set = spec.mapping[m.column.name];
              const value = set == null ? AUTO : set === '' ? DEFAULT : set;
              const auto = m.source && set == null ? `Matched by name: ${m.source}` : 'Matched by name: none';
              return (
                <li key={m.column.name}>
                  <Field label={m.column.name} htmlFor={`map-${m.column.name}`}>
                    <Select
                      id={`map-${m.column.name}`}
                      options={[{ value: AUTO, label: set == null ? auto : 'Match by name' }, { value: DEFAULT, label: m.column.default != null ? 'Its default' : 'Leave empty' }, ...inputColumns.map((c) => ({ value: c, label: c }))]}
                      value={value}
                      onChange={(e) => {
                        const v = e.target.value;
                        const mapping = { ...spec.mapping };
                        if (v === AUTO) delete mapping[m.column.name];
                        else mapping[m.column.name] = v === DEFAULT ? '' : v;
                        update({ mapping });
                      }}
                    />
                  </Field>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
