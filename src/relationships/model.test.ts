import { flow, src } from '../../tests/helpers/projects';
import { parseProject, setSchemaCheck, type ColumnSchema, type Project, type Rule } from '../model';
import { cardinality, declaredKeys, describeCardinality, findRelationships, homeOf, keyColumns, keyEnds, relationshipTables } from './model';

const cols = (...names: string[]): ColumnSchema[] => names.map((name) => ({ name, type: 'VARCHAR' }));

/** Orders cleaned in a Transform (which adds `total_gbp`), joined to Customers; Products only in a Query. */
function shop(): Project {
  return flow({
    sources: [src({ id: 'a', format: 'csv' })],
    nodes: [
      { id: 'orders', type: 'source', sourceId: 'a' },
      { id: 'clean', type: 'transform' },
      { id: 'customers', type: 'source', sourceId: 'a' },
      { id: 'products', type: 'source', sourceId: 'a' },
      { id: 'j', type: 'join', joinSpec: { keys: [{ left: 'customer_id', right: 'customer_id' }] } },
      { id: 'q', type: 'query', querySpec: { joins: [{ id: 'qj', left: { port: 0, column: 'product_id' }, right: { port: 1, column: 'id' }, kind: 'inner' }] } },
      { id: 'lonely', type: 'transform' },
    ],
    wires: [['orders', 'clean'], ['clean', 'j', 'left'], ['customers', 'j', 'right'], ['clean', 'q', 0], ['products', 'q', 1]],
  });
}

const columns: Record<string, ColumnSchema[]> = {
  orders: cols('order_id', 'customer_id', 'product_id'),
  clean: cols('order_id', 'customer_id', 'product_id', 'total_gbp'),
  customers: cols('customer_id', 'name'),
  products: cols('id', 'title'),
};
const columnsOf = (id: string) => columns[id];

describe('relationships', () => {
  it('finds the keys of joins and query join lines, on the tables the columns come from', () => {
    const rels = findRelationships(shop(), columnsOf);
    expect(rels.map((r) => [`${r.from.nodeId}.${r.from.column}`, `${r.to.nodeId}.${r.to.column}`, r.via.map((v) => v.kind)])).toEqual([
      ['orders.customer_id', 'customers.customer_id', ['join']],
      ['orders.product_id', 'products.id', ['query']],
    ]);
  });

  it('keeps a column a step made on the node that has it, and stays put while columns are unknown', () => {
    const p = shop();
    expect(homeOf(p, { nodeId: 'clean', column: 'total_gbp' }, columnsOf)).toEqual({ nodeId: 'clean', column: 'total_gbp' });
    expect(homeOf(p, { nodeId: 'clean', column: 'customer_id' }, () => undefined)).toEqual({ nodeId: 'clean', column: 'customer_id' });
  });

  it('counts the same pair once, whichever way round, with each place that states it', () => {
    const p = shop();
    const rule: Rule = { id: 'r1', type: 'referential', label: 'Every customer_id exists in customers.customer_id', enabled: true, severity: 'fail', params: { column: 'customer_id', node: 'customers', nodeColumn: 'customer_id' } };
    const off: Rule = { ...rule, id: 'r2', enabled: false, params: { column: 'name', node: 'products', nodeColumn: 'title' } };
    const withRule = { ...p, nodes: p.nodes.map((n) => (n.id === 'orders' ? { ...n, rules: [rule, off] } : n)) };
    const rels = findRelationships(withRule, columnsOf);
    expect(rels).toHaveLength(2);
    expect(rels[0]!.via.map((v) => v.label)).toEqual(['Every customer_id exists in customers.customer_id', 'j']);
  });

  it('reads an "in set" rule that takes its values from a node, but not one with a typed list', () => {
    const p = shop();
    const inSet = (from: string): Rule => ({ id: from, type: 'inSet', label: from, enabled: true, severity: 'warn', params: { from, column: 'name', node: 'products', nodeColumn: 'title', values: [] } });
    const withRules = { ...p, nodes: p.nodes.map((n) => (n.id === 'customers' ? { ...n, rules: [inSet('node'), inSet('list')] } : n)) };
    expect(findRelationships(withRules, columnsOf).filter((r) => r.via[0]!.kind === 'rule').map((r) => r.via[0]!.label)).toEqual(['node']);
  });

  it('ignores a join whose input isn’t wired yet, and a key not filled in', () => {
    const p = shop();
    const unwired = { ...p, edges: p.edges.filter((e) => e.to.port !== 'right') };
    expect(findRelationships(unwired, columnsOf).map((r) => r.via[0]!.kind)).toEqual(['query']);
    const blank = { ...p, nodes: p.nodes.map((n) => (n.type === 'join' ? { ...n, joinSpec: { ...n.joinSpec, keys: [{ left: 'customer_id', right: '' }] } } : n)) };
    expect(findRelationships(blank, columnsOf).map((r) => r.via[0]!.kind)).toEqual(['query']);
  });

  it('draws every source and each other table a relationship ends on, related tables next to each other', () => {
    const p = shop();
    const tables = relationshipTables(p, findRelationships(p, columnsOf), columnsOf);
    expect(tables.map((t) => [t.name, t.kind, t.columns?.length])).toEqual([
      ['orders', 'source', 3],
      ['customers', 'source', 2],
      ['products', 'source', 2],
    ]);
    // A step's column relates from the Transform, which is then drawn too.
    const derived = { ...p, nodes: p.nodes.map((n) => (n.type === 'join' ? { ...n, joinSpec: { ...n.joinSpec, keys: [{ left: 'total_gbp', right: 'name' }] } } : n)) };
    expect(relationshipTables(derived, findRelationships(derived, columnsOf), columnsOf).map((t) => t.name)).toEqual(['orders', 'products', 'clean', 'customers']);
  });

  it('checks one or many where the first place that states it reads the columns', () => {
    const rels = findRelationships(shop(), columnsOf);
    // The Join reads the cleaned orders, so they're checked there, though drawn on the source.
    expect(rels[0]!.read).toEqual({ from: { nodeId: 'clean', column: 'customer_id' }, to: { nodeId: 'customers', column: 'customer_id' } });
    expect(Object.fromEntries(keyColumns(rels))).toEqual({ clean: ['customer_id', 'product_id'], customers: ['customer_id'], products: ['id'] });
    const unique = { clean: { customer_id: false }, customers: { customer_id: true } };
    expect(describeCardinality(unique, rels[0]!)).toBe('many to one');
    expect(cardinality(unique, rels[0]!, 'to')).toBe('one');
    expect(describeCardinality(unique, rels[1]!)).toBeUndefined();
    expect([...keyEnds(rels, unique)]).toEqual(['customers:customer_id']);
  });
});

describe('schema tables', () => {
  const DBML = 'Table customers {\n  customer_id int [pk]\n  email text [unique]\n}\nTable orders {\n  order_id int [pk]\n  customer_id int\n}\nRef sold: orders.customer_id > customers.customer_id';
  const p = parseProject({
    ...flow({ nodes: [{ id: 'c', type: 'table', tableSpec: { table: 'customers' } }, { id: 'o', type: 'table', tableSpec: { table: 'orders' } }, { id: 'x', type: 'transform' }] }),
    schema: { dbml: DBML, positions: {} },
  });

  it('draws every schema table, related by the schema’s refs', () => {
    const rels = findRelationships(p, () => undefined);
    expect(rels.map((r) => [r.from, r.to, r.via.map((v) => [v.kind, v.label])])).toEqual([[{ nodeId: 'o', column: 'customer_id' }, { nodeId: 'c', column: 'customer_id' }, [['schema', 'Ref sold']]]]);
    expect(relationshipTables(p, rels, () => undefined).map((t) => t.nodeId)).toEqual(['c', 'o']);
  });

  it('marks a node checked against a schema table, related to the parent by its derived exists-in rule', () => {
    const checked = setSchemaCheck(p, 'x', { schema: 'public', table: 'orders', mapping: {} });
    const rels = findRelationships(checked, () => undefined);
    expect(rels.some((r) => r.from.nodeId === 'x' && r.to.nodeId === 'c' && r.via[0]!.kind === 'rule')).toBe(true);
    const tables = relationshipTables(checked, rels, () => undefined);
    expect(tables.find((t) => t.nodeId === 'x')?.checkedAgainst).toBe('orders');
    expect(tables.find((t) => t.nodeId === 'o')?.checkedAgainst).toBeUndefined();
  });

  it('counts a table’s primary key and unique columns as the one end', () => {
    expect(declaredKeys(p)).toEqual({ c: { customer_id: true, email: true }, o: { order_id: true } });
  });
});
