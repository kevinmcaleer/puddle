// Relating two columns from the relationships view: kept as a rule, so it's saved with the project and checked, and
// written into the project's DBML as a Ref when the DBML documents both tables, so the schema says it too.
import { addRule, nodeById, setSchemaDbml, type GraphNode, type Project } from '../model';
import { newRule, ruleLabel } from '../rules';
import { addRef } from '../schema/edit';
import { DEFAULT_SCHEMA, type DbmlSchema, type Table } from '../schema/model';
import { parseDbml } from '../schema/parse';
import type { End } from './model';

/** The DBML table that documents a node: its Schema table, or the public table with the node's name. */
export function documentingTable(schema: DbmlSchema, node: GraphNode): Table | undefined {
  if (node.type === 'table') return schema.tables.find((t) => t.schema === node.tableSpec.schema && t.name === node.tableSpec.table);
  return schema.tables.find((t) => t.schema === DEFAULT_SCHEMA && t.name === node.name);
}

/**
 * The DBML with a many-to-one Ref from one column to the other, when the DBML has a table for each node with that
 * column and doesn't relate them already, either way round. Otherwise the text as it is.
 */
export function withDbmlRef(project: Project, from: End, to: End): string {
  const text = project.schema.dbml;
  if (!text.trim()) return text;
  const schema = parseDbml(text).schema;
  const end = (e: End) => {
    const node = nodeById(project, e.nodeId);
    const table = node && documentingTable(schema, node);
    return table?.columns.some((c) => c.name === e.column) ? { schema: table.schema, table: table.name, column: e.column } : undefined;
  };
  const [a, b] = [end(from), end(to)];
  if (!a || !b) return text;
  const is = (x: { schema: string; table: string; columns: string[] }, y: typeof a) => x.schema === y.schema && x.table === y.table && x.columns.length === 1 && x.columns[0] === y.column;
  if (schema.refs.some((r) => (is(r.from, a) && is(r.to, b)) || (is(r.from, b) && is(r.to, a)))) return text;
  return addRef(text, { from: a, to: b, op: '>' });
}

/**
 * Relate one column to another, as drawn from `from` onto `to`: a rule on `from`'s table that every value of the
 * column exists in `to`'s column ("every customer_id exists in Customers.customer_id"), and a Ref in the DBML when it
 * has both tables. Nothing to do when it's the same table, or that rule is already there.
 */
export function relate(project: Project, from: End, to: End): Project {
  const node = nodeById(project, from.nodeId);
  if (!node || from.nodeId === to.nodeId || !nodeById(project, to.nodeId)) return project;
  const params = { column: from.column, node: to.nodeId, nodeColumn: to.column };
  const same = (p: Record<string, unknown>) => p.column === params.column && p.node === params.node && p.nodeColumn === params.nodeColumn;
  if (node.rules.some((r) => r.type === 'referential' && same(r.params))) return project;
  const names = (id: string) => nodeById(project, id)?.name;
  const rule = newRule('referential', { selected: [from.column], available: [] }, names);
  const ruled = addRule(project, from.nodeId, { ...rule, params, label: ruleLabel({ type: rule.type, params }, names) });
  return setSchemaDbml(ruled, withDbmlRef(ruled, from, to));
}
