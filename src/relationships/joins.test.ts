import { flow, src } from '../../tests/helpers/projects';
import { nodeById, type ColumnSchema, type Project, type QueryNode, type Rule } from '../model';
import { addRelatedTable, relatedJoins, relatedKeys, withRelatedJoins } from './joins';

const cols = (...names: string[]): ColumnSchema[] => names.map((name) => ({ name, type: 'VARCHAR' }));

/** Orders (through a Transform) and Customers, related once by a rule as the Relationships view draws it; a Query reading the orders. */
function shop(wired: Array<[string, string, number]> = [['clean', 'q', 0]]): Project {
  const p = flow({
    sources: [src({ id: 'a', format: 'csv' })],
    nodes: [
      { id: 'orders', type: 'source', sourceId: 'a' },
      { id: 'clean', type: 'transform' },
      { id: 'customers', type: 'source', sourceId: 'a' },
      { id: 'q', type: 'query' },
    ],
    wires: [['orders', 'clean'], ...wired],
  });
  const rule: Rule = { id: 'r1', type: 'referential', label: 'Every customer_id exists in customers.customer_id', enabled: true, severity: 'fail', params: { column: 'customer_id', node: 'customers', nodeColumn: 'customer_id' } };
  return { ...p, nodes: p.nodes.map((n) => (n.id === 'orders' ? { ...n, rules: [rule] } : n)) };
}

const columns: Record<string, ColumnSchema[]> = { orders: cols('order_id', 'customer_id'), clean: cols('order_id', 'customer_id'), customers: cols('customer_id', 'name') };
const columnsOf = (id: string) => columns[id];
const joinsOf = (p: Project) => (nodeById(p, 'q') as QueryNode).querySpec.joins.map((j) => `${j.left.port}.${j.left.column} = ${j.right.port}.${j.right.column} ${j.kind}`);

describe('relationships carried into queries', () => {
  it('joins a table added to the designer to the tables there on their relationship, read through Transforms', () => {
    const p = addRelatedTable(shop(), 'q', 'customers', columnsOf);
    expect(joinsOf(p)).toEqual(['0.customer_id = 1.customer_id inner']);
  });

  it('joins whichever way round the table is added', () => {
    const p = addRelatedTable(shop([['customers', 'q', 0]]), 'q', 'clean', columnsOf);
    expect(joinsOf(p)).toEqual(['0.customer_id = 1.customer_id inner']);
  });

  it('adds no join when nothing relates the tables, or the column isn’t there any more', () => {
    const p = shop();
    const unrelated = { ...p, nodes: p.nodes.map((n) => ({ ...n, rules: [] })) };
    expect(joinsOf(addRelatedTable(unrelated, 'q', 'customers', columnsOf))).toEqual([]);
    // A step renamed the key: the Transform no longer gives the query the orders' customer_id.
    const renamed = (id: string) => (id === 'clean' ? cols('order_id', 'customer') : columns[id]);
    expect(relatedJoins(addRelatedTable(p, 'q', 'customers', renamed), 'q', 1, renamed)).toEqual([]);
  });

  it('joins every related pair of a new Query’s tables once', () => {
    const p = withRelatedJoins(shop([['clean', 'q', 0], ['customers', 'q', 1]]), 'q', columnsOf);
    expect(joinsOf(p)).toEqual(['0.customer_id = 1.customer_id inner']);
    expect(joinsOf(withRelatedJoins(p, 'q', columnsOf))).toEqual(['0.customer_id = 1.customer_id inner']);
  });

  it('gives a Join or Lookup its keys from the relationship, left side first', () => {
    expect(relatedKeys(shop(), 'clean', 'customers', columnsOf)).toEqual([{ left: 'customer_id', right: 'customer_id' }]);
    const p = shop();
    const other: Rule = { id: 'r2', type: 'referential', label: 'x', enabled: true, severity: 'fail', params: { column: 'name', node: 'orders', nodeColumn: 'order_id' } };
    const both = { ...p, nodes: p.nodes.map((n) => (n.id === 'customers' ? { ...n, rules: [other] } : n)) };
    expect(relatedKeys(both, 'clean', 'customers', columnsOf)).toEqual([
      { left: 'customer_id', right: 'customer_id' },
      { left: 'order_id', right: 'name' },
    ]);
    expect(relatedKeys(shop(), 'customers', 'customers', columnsOf)).toEqual([]);
  });
});
