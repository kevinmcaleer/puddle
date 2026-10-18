// Relating two columns from the relationships view: kept as a rule, so it's saved with the project and checked.
import { addRule, nodeById, type Project } from '../model';
import { newRule, ruleLabel } from '../rules';
import type { End } from './model';

/**
 * Relate one column to another, as drawn from `from` onto `to`: a rule on `from`'s table that every value of the
 * column exists in `to`'s column ("every customer_id exists in Customers.customer_id"). Nothing to do when it's the
 * same table, or that rule is already there.
 */
export function relate(project: Project, from: End, to: End): Project {
  const node = nodeById(project, from.nodeId);
  if (!node || from.nodeId === to.nodeId || !nodeById(project, to.nodeId)) return project;
  const params = { column: from.column, node: to.nodeId, nodeColumn: to.column };
  const same = (p: Record<string, unknown>) => p.column === params.column && p.node === params.node && p.nodeColumn === params.nodeColumn;
  if (node.rules.some((r) => r.type === 'referential' && same(r.params))) return project;
  const names = (id: string) => nodeById(project, id)?.name;
  const rule = newRule('referential', { selected: [from.column], available: [] }, names);
  return addRule(project, from.nodeId, { ...rule, params, label: ruleLabel({ type: rule.type, params }, names) });
}
