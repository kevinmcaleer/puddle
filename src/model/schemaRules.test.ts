import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flow } from '../../tests/helpers/projects';
import { deriveSchemaRules, keepSchemaRules, setSchemaCheck, setSchemaDbml, syncSchemaRules, type Project } from '.';

const DBML = readFileSync(join(__dirname, '../../tests/fixtures/dbml/rules.dbml'), 'utf8');

/** A source feeding a Schema table node for customers, the DBML set. */
function project(dbml = DBML): Project {
  const p = flow({ nodes: [{ id: 'csv', type: 'transform' }, { id: 'cust', type: 'table', tableSpec: { schema: 'public', table: 'customers' } }, { id: 'ord', type: 'transform' }], wires: [] });
  return setSchemaDbml(p, dbml);
}

const check = (table: string, mapping: Record<string, string> = {}) => ({ schema: 'public', table, mapping });
const summary = (p: Project, node: string) => p.nodes.find((n) => n.id === node)!.rules.map((r) => [r.id, r.type, r.severity, r.params]);

describe('deriveSchemaRules', () => {
  it('turns each constraint of a table into a rule', () => {
    const rules = deriveSchemaRules(project(), check('customers'));
    expect(rules.map((r) => [r.id, r.type, r.severity, r.params])).toEqual([
      ['schema-unique-id', 'unique', 'fail', { columns: ['id'] }],
      ['schema-unique-email', 'unique', 'fail', { columns: ['email'] }],
      ['schema-notEmpty-id', 'notEmpty', 'fail', { column: 'id' }],
      ['schema-readsAs-id', 'readsAs', 'warn', { column: 'id', as: 'integer' }],
      ['schema-notEmpty-email', 'notEmpty', 'fail', { column: 'email' }],
      ['schema-inSet-tier', 'inSet', 'fail', { column: 'tier', from: 'list', values: ['gold', 'silver'], node: '', nodeColumn: '', matchCase: true }],
      ['schema-readsAs-age', 'readsAs', 'warn', { column: 'age', as: 'integer' }],
      ['schema-check-age-1', 'expression', 'fail', { expression: 'age >= 0' }],
      ['schema-readsAs-joined', 'readsAs', 'warn', { column: 'joined', as: 'date' }],
    ]);
    expect(rules.every((r) => r.fromSchema?.table === 'customers')).toBe(true);
  });

  it('turns a ref into an exists-in rule on the parent’s Schema table node, and table checks into expressions', () => {
    const rules = deriveSchemaRules(project(), check('orders'));
    expect(rules.find((r) => r.type === 'referential')).toMatchObject({ id: 'schema-ref-customer_id-customers', params: { column: 'customer_id', node: 'cust', nodeColumn: 'id' } });
    expect(rules.find((r) => r.id === 'schema-check-positive_id')).toMatchObject({ type: 'expression', params: { expression: 'order_id > 0' } });
    // A column the database fills (a default expression) is still checked for its type, not for being there.
    expect(rules.some((r) => r.id === 'schema-notEmpty-placed')).toBe(false);
  });

  it('has no ref rule while the parent has no Schema table node', () => {
    const p = project();
    const without = { ...p, nodes: p.nodes.filter((n) => n.id !== 'cust') };
    expect(deriveSchemaRules(without, check('orders')).some((r) => r.type === 'referential')).toBe(false);
  });

  it('reads columns through the mapping', () => {
    const rules = deriveSchemaRules(project(), check('customers', { email: 'Email address' }));
    expect(rules.find((r) => r.id === 'schema-notEmpty-email')).toMatchObject({ label: 'Email address is never empty', params: { column: 'Email address' } });
  });

  it('derives nothing for a table the schema doesn’t have', () => {
    expect(deriveSchemaRules(project(), check('nope'))).toEqual([]);
  });
});

describe('schema checks on a node', () => {
  it('adds the rules after the node’s own, and takes them away when the check is turned off', () => {
    let p = project();
    p = { ...p, nodes: p.nodes.map((n) => (n.id === 'csv' ? { ...n, rules: [{ id: 'mine', type: 'notEmpty', label: 'mine', enabled: true, severity: 'warn', params: { column: 'note' } }] } : n)) } as Project;
    p = setSchemaCheck(p, 'csv', check('customers'));
    expect(summary(p, 'csv')[0]![0]).toBe('mine');
    expect(summary(p, 'csv')).toHaveLength(10);
    p = setSchemaCheck(p, 'csv', undefined);
    expect(summary(p, 'csv').map((r) => r[0])).toEqual(['mine']);
  });

  it('follows the DBML: removing not null removes that rule and keeps the rest as they were switched', () => {
    let p = setSchemaCheck(project(), 'csv', check('customers'));
    p = { ...p, nodes: p.nodes.map((n) => (n.id === 'csv' ? { ...n, rules: n.rules.map((r) => (r.id === 'schema-unique-email' ? { ...r, enabled: false, severity: 'warn' as const } : r)) } : n)) } as Project;
    p = setSchemaDbml(p, DBML.replace('email varchar [unique, not null]', 'email varchar [unique]'));
    const rules = p.nodes.find((n) => n.id === 'csv')!.rules;
    expect(rules.some((r) => r.id === 'schema-notEmpty-email')).toBe(false);
    expect(rules.find((r) => r.id === 'schema-unique-email')).toMatchObject({ enabled: false, severity: 'warn' });
    expect(p.nodes.find((n) => n.id === 'csv')!.schemaCheck).toEqual(check('customers'));
  });

  it('is the same project when nothing derived changes', () => {
    const p = setSchemaCheck(project(), 'csv', check('customers'));
    expect(syncSchemaRules(p)).toBe(p);
    const plain = project();
    expect(syncSchemaRules(plain)).toBe(plain);
  });

  it('Add as rules keeps them as ordinary rules that the DBML no longer changes', () => {
    let p = keepSchemaRules(setSchemaCheck(project(), 'csv', check('customers')), 'csv');
    const node = p.nodes.find((n) => n.id === 'csv')!;
    expect(node.schemaCheck).toBeUndefined();
    expect(node.rules.every((r) => !r.fromSchema && r.id.startsWith('r-'))).toBe(true);
    p = setSchemaDbml(p, DBML.replace('email varchar [unique, not null]', 'email varchar'));
    expect(p.nodes.find((n) => n.id === 'csv')!.rules).toEqual(node.rules);
  });
});
