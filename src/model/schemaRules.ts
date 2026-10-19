// Quality rules derived from the project's DBML: a node checked against a schema table gets a rule for each thing the
// design says about that table (keys and unique columns have no repeats, not null columns no empties, enum columns
// only the enum's values, refs exist in the parent's Schema table node, checks hold, values read as the designed
// type). They are rewritten whenever the DBML or the check changes, keeping each one's enabled and severity.
import { foreignKey, primaryKey } from '../compiler/ddl/duckdb';
import { typeKind } from '../compiler/ddl/types';
import { parseDbml } from '../schema/parse';
import { enumOf, qualified, type DbmlSchema, type Table } from '../schema/model';
import type { GraphNode, Project, Rule, SchemaCheck } from './schema';

let parsed: { dbml: string; schema: DbmlSchema } | null = null;

/** The project's schema, parsed once per text. */
function schemaOf(dbml: string): DbmlSchema {
  if (parsed?.dbml !== dbml) parsed = { dbml, schema: parseDbml(dbml).schema };
  return parsed.schema;
}

/** How a designed type is checked: values that wouldn't read as it are warnings. */
function readsAsFor(type: string): 'integer' | 'number' | 'date' | 'boolean' | undefined {
  const k = typeKind(type);
  if (!k) return undefined;
  if (k.kind === 'int') return 'integer';
  if (k.kind === 'decimal' || k.kind === 'float' || k.kind === 'double') return 'number';
  if (k.kind === 'date' || k.kind === 'timestamp' || k.kind === 'timestamptz') return 'date';
  if (k.kind === 'boolean') return 'boolean';
  return undefined;
}

/** The Schema table node holding a table, if the project has one. */
const tableNode = (project: Project, schema: string, table: string) => project.nodes.find((n) => n.type === 'table' && n.tableSpec.schema === schema && n.tableSpec.table === table);

/** The rules a schema check derives for a node, as they would be written fresh. */
export function deriveSchemaRules(project: Project, check: SchemaCheck, schema: DbmlSchema = schemaOf(project.schema.dbml)): Rule[] {
  const t: Table | undefined = schema.tables.find((x) => x.schema === check.schema && x.name === check.table);
  if (!t) return [];
  const col = (c: string) => check.mapping[c] || c;
  const from = { schema: t.schema, table: t.name };
  const rules: Rule[] = [];
  const add = (id: string, type: string, label: string, params: Record<string, unknown>, severity: Rule['severity'] = 'fail') => rules.push({ id: `schema-${id}`, type, label, enabled: true, severity, params, fromSchema: from });

  const pk = primaryKey(t);
  const keys = [...(pk.length ? [pk] : []), ...t.columns.filter((c) => c.unique && !(pk.length === 1 && pk[0] === c.name)).map((c) => [c.name]), ...t.indexes.filter((i) => i.unique && !i.pk && i.parts.every((p) => p.kind === 'column')).map((i) => i.parts.map((p) => p.value))];
  for (const key of keys) {
    const columns = key.map(col);
    add(`unique-${key.join('-')}`, 'unique', columns.length === 1 ? `${columns[0]} is unique` : `${columns.join(', ')} together are unique`, { columns });
  }
  for (const c of t.columns) {
    if (c.notNull || pk.includes(c.name)) add(`notEmpty-${c.name}`, 'notEmpty', `${col(c.name)} is never empty`, { column: col(c.name) });
    const e = enumOf(schema, c);
    if (e) {
      const values = e.values.map((v) => v.name);
      add(`inSet-${c.name}`, 'inSet', `${col(c.name)} is one of the values of ${qualified(e.schema, e.name)}`, { column: col(c.name), from: 'list', values, node: '', nodeColumn: '', matchCase: true });
    } else {
      const as = readsAsFor(c.type);
      if (as) add(`readsAs-${c.name}`, 'readsAs', `${col(c.name)} reads as ${c.type}`, { column: col(c.name), as }, 'warn');
    }
    c.checks.forEach((x, i) => add(`check-${c.name}-${i + 1}`, 'expression', `Every row: ${x}`, { expression: x }));
  }
  t.checks.forEach((x, i) => add(`check-${x.name ?? i + 1}`, 'expression', `Every row: ${x.expression}`, { expression: x.expression }));
  for (const r of schema.refs) {
    const fk = foreignKey(r);
    if (!fk || fk.child.schema !== t.schema || fk.child.table !== t.name || fk.child.columns.length !== 1) continue;
    const parent = tableNode(project, fk.parent.schema, fk.parent.table);
    if (!parent) continue;
    const column = col(fk.child.columns[0]!);
    add(`ref-${fk.child.columns[0]}-${fk.parent.table}`, 'referential', `Every ${column} exists in ${parent.name}.${fk.parent.columns[0]}`, { column, node: parent.id, nodeColumn: fk.parent.columns[0] });
  }
  return rules;
}

/** A node's rules with its derived ones rewritten: its own rules first, as they were; derived ones keep their switches. */
function withDerived(project: Project, node: GraphNode, schema: DbmlSchema): GraphNode {
  const old = node.rules.filter((r) => r.fromSchema);
  if (!node.schemaCheck && !old.length) return node;
  const fresh = node.schemaCheck ? deriveSchemaRules(project, node.schemaCheck, schema) : [];
  const kept = fresh.map((r) => {
    const was = old.find((o) => o.id === r.id);
    return was ? { ...r, enabled: was.enabled, severity: was.severity } : r;
  });
  const same = kept.length === old.length && kept.every((r, i) => JSON.stringify(r) === JSON.stringify(old[i]));
  return same ? node : ({ ...node, rules: [...node.rules.filter((r) => !r.fromSchema), ...kept] } as GraphNode);
}

/** Rewrite every node's derived rules from the project's DBML; the same project when none change. */
export function syncSchemaRules(project: Project): Project {
  if (!project.nodes.some((n) => n.schemaCheck || n.rules.some((r) => r.fromSchema))) return project;
  const schema = schemaOf(project.schema.dbml);
  let changed = false;
  const nodes = project.nodes.map((n) => {
    const next = withDerived(project, n, schema);
    changed ||= next !== n;
    return next;
  });
  return changed ? { ...project, nodes } : project;
}

/** Check a node against a schema table, or stop checking it (its derived rules go with it). */
export function setSchemaCheck(project: Project, nodeId: string, check: SchemaCheck | undefined): Project {
  const nodes = project.nodes.map((n) => (n.id === nodeId ? ({ ...n, schemaCheck: check } as GraphNode) : n));
  return syncSchemaRules({ ...project, nodes });
}

/** Keep a node's derived rules as ordinary rules to edit, and stop deriving them. */
export function keepSchemaRules(project: Project, nodeId: string): Project {
  return {
    ...project,
    nodes: project.nodes.map((n) => (n.id === nodeId ? ({ ...n, schemaCheck: undefined, rules: n.rules.map(({ fromSchema: _from, ...r }) => ({ ...r, id: _from ? r.id.replace(/^schema-/, 'r-') : r.id })) } as GraphNode) : n)),
  };
}
