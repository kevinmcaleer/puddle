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

describe('relating two columns the DBML documents', () => {
  const dbml = 'Table orders {\n  customer_id int\n  status text\n}\n\nTable customers {\n  id int\n}\n';
  const withDbml = (text: string) => ({ ...base(), schema: { ...base().schema, dbml: text } });

  // Regression: a relationship drawn after the tables went into the Schema view showed on the diagram, never in the DBML.
  it('writes a Ref line beneath the tables', () => {
    const p = relate(withDbml(dbml), { nodeId: 'orders', column: 'customer_id' }, { nodeId: 'customers', column: 'id' });
    expect(p.schema.dbml).toBe(`${dbml}\nRef: orders.customer_id > customers.id\n`);
  });

  it('leaves the DBML alone when it lacks a table or column, or already relates them either way round', () => {
    const missing = 'Table orders {\n  customer_id int\n}\n';
    expect(relate(withDbml(missing), { nodeId: 'orders', column: 'customer_id' }, { nodeId: 'customers', column: 'id' }).schema.dbml).toBe(missing);
    expect(relate(withDbml(dbml), { nodeId: 'orders', column: 'nope' }, { nodeId: 'customers', column: 'id' }).schema.dbml).toBe(dbml);
    const said = `${dbml}\nRef: customers.id < orders.customer_id\n`;
    expect(relate(withDbml(said), { nodeId: 'orders', column: 'customer_id' }, { nodeId: 'customers', column: 'id' }).schema.dbml).toBe(said);
    expect(relate(base(), { nodeId: 'orders', column: 'customer_id' }, { nodeId: 'customers', column: 'id' }).schema.dbml).toBe('');
  });
});
