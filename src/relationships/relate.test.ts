import { flow, src } from '../../tests/helpers/projects';
import { relate } from './relate';

const base = () =>
  flow({
    sources: [src({ id: 'a', format: 'csv' })],
    nodes: [
      { id: 'orders', type: 'source', sourceId: 'a' },
      { id: 'customers', type: 'source', sourceId: 'a' },
    ],
  });

describe('relating two columns', () => {
  it('adds an "exists in another node" rule to the first column’s table', () => {
    const p = relate(base(), { nodeId: 'orders', column: 'customer_id' }, { nodeId: 'customers', column: 'id' });
    const rules = p.nodes.find((n) => n.id === 'orders')!.rules;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ type: 'referential', severity: 'fail', enabled: true, label: 'Every customer_id exists in customers.id', params: { column: 'customer_id', node: 'customers', nodeColumn: 'id' } });
  });

  it('does nothing for the same table, a missing node, or a relationship already there', () => {
    const p = base();
    expect(relate(p, { nodeId: 'orders', column: 'a' }, { nodeId: 'orders', column: 'b' })).toBe(p);
    expect(relate(p, { nodeId: 'orders', column: 'a' }, { nodeId: 'gone', column: 'b' })).toBe(p);
    const once = relate(p, { nodeId: 'orders', column: 'a' }, { nodeId: 'customers', column: 'b' });
    expect(relate(once, { nodeId: 'orders', column: 'a' }, { nodeId: 'customers', column: 'b' })).toBe(once);
  });
});
