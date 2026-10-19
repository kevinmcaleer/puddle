import { useMemo } from 'react';
import { useNodeStatus } from '../flow/status';
import { keepSchemaRules, setSchemaCheck, useProject, useProjectStore, type GraphNode, type SchemaCheck } from '../model';
import { qualified } from '../schema/model';
import { parseDbml } from '../schema/parse';
import { Button, Field, Select } from '../ui';

const apply = (edit: Parameters<ReturnType<typeof useProjectStore.getState>['apply']>[0]) => useProjectStore.getState().apply(edit);

/** The project's schema tables, parsed once per DBML text. */
function useSchemaTables() {
  const dbml = useProject().schema.dbml;
  return useMemo(() => (dbml.trim() ? parseDbml(dbml).schema.tables : []), [dbml]);
}

/**
 * Check a node against one of the schema's tables: its keys, not null columns, enums, refs, checks and types become
 * rules, rewritten when the DBML changes. Columns named differently in the data are matched here.
 */
export function SchemaCheckPanel({ node }: { node: GraphNode }) {
  const tables = useSchemaTables();
  const status = useNodeStatus(node.id);
  const check = node.schemaCheck;
  if (!tables.length && !check) return null;
  const key = (schema: string, table: string) => `${schema}.${table}`;
  const table = check && tables.find((t) => t.schema === check.schema && t.name === check.table);
  const columns = status.state === 'ok' ? status.columns.map((c) => c.name) : [];
  const set = (next: SchemaCheck | undefined) => apply((p) => setSchemaCheck(p, node.id, next));
  const derived = node.rules.filter((r) => r.fromSchema).length;
  return (
    <div className="flex flex-col gap-2 pb-2" data-testid="schema-check">
      <Field label="Check against the schema" htmlFor="schema-check-table" hint={check && !table ? `${qualified(check.schema, check.table)} is no longer in the schema.` : undefined}>
        <Select
          id="schema-check-table"
          value={check ? key(check.schema, check.table) : ''}
          options={[
            { value: '', label: 'No schema table' },
            ...(check && !table ? [{ value: key(check.schema, check.table), label: qualified(check.schema, check.table) }] : []),
            ...tables.map((t) => ({ value: key(t.schema, t.name), label: qualified(t.schema, t.name) })),
          ]}
          onChange={(e) => {
            const t = tables.find((x) => key(x.schema, x.name) === e.target.value);
            set(t ? { schema: t.schema, table: t.name, mapping: {} } : undefined);
          }}
        />
      </Field>
      {table && columns.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="schema-check-mapping">
          {table.columns.every((c) => columns.includes(check.mapping[c.name] || c.name)) ? (
            <p className="text-label text-ink-muted">Every column of {qualified(table.schema, table.name)} is found by name.</p>
          ) : (
            <p className="text-label text-ink-muted">Match the columns named differently in this data.</p>
          )}
          {table.columns
            .filter((c) => check.mapping[c.name] || !columns.includes(c.name))
            .map((c) => (
              <Field key={c.name} label={c.name} htmlFor={`schema-map-${c.name}`}>
                <Select
                  id={`schema-map-${c.name}`}
                  value={check.mapping[c.name] ?? ''}
                  options={[{ value: '', label: 'Not in this data' }, ...columns.map((n) => ({ value: n, label: n }))]}
                  onChange={(e) => {
                    const mapping = { ...check.mapping };
                    if (e.target.value) mapping[c.name] = e.target.value;
                    else delete mapping[c.name];
                    set({ ...check, mapping });
                  }}
                />
              </Field>
            ))}
        </div>
      )}
      {derived > 0 && (
        <div>
          <Button size="sm" variant="ghost" icon="plus" onClick={() => apply((p) => keepSchemaRules(p, node.id))}>
            Add as rules
          </Button>
        </div>
      )}
    </div>
  );
}
