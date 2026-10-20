import { flow, src, step } from '../../tests/helpers/projects';
import type { ColumnSchema, Project, Rule } from '../model';
import { canvasSchema, CANVAS_GROUPS, withCanvas } from './canvas';
import { emptySchema } from './model';
import { parseDbml } from './parse';

const cols = (...names: string[]): ColumnSchema[] => names.map((name) => ({ name, type: 'VARCHAR' }));

/** Orders cleaned in two Transform steps, joined to Customers, and in a Query with Products; the join exported. */
function shop(): Project {
  const p = flow({
    sources: [src({ id: 'a', format: 'csv', file: { originalName: 'orders.csv', size: 1, lastModified: 0, headHash: '' } })],
    nodes: [
      { id: 'orders', type: 'source', sourceId: 'a' },
      { id: 'trim', type: 'transform', steps: [step('s1', 'trim', {})] },
      { id: 'clean', type: 'transform', steps: [step('s2', 'case', {})] },
      { id: 'customers', type: 'source', sourceId: 'a' },
      { id: 'products', type: 'source', sourceId: 'a' },
      { id: 'j', type: 'join', joinSpec: { keys: [{ left: 'customer_id', right: 'customer_id' }] } },
      { id: 'q', type: 'query', querySpec: { joins: [{ id: 'qj', left: { port: 0, column: 'product_id' }, right: { port: 1, column: 'id' }, kind: 'inner' }], fields: [{ id: 'f1', port: 1, column: 'title', show: true, sort: 'none' }] } },
      { id: 'out', type: 'output' },
    ],
    wires: [['orders', 'trim'], ['trim', 'clean'], ['clean', 'j', 'left'], ['customers', 'j', 'right'], ['clean', 'q', 0], ['products', 'q', 1], ['j', 'out']],
  });
  return p;
}

const columns: Record<string, ColumnSchema[]> = {
  orders: cols('order_id', 'customer_id', 'product_id'),
  trim: cols('order_id', 'customer_id', 'product_id'),
  clean: cols('order_id', 'customer_id', 'product_id'),
  customers: cols('customer_id', 'name'),
  products: cols('id', 'title'),
  j: cols('order_id', 'customer_id', 'product_id', 'name'),
  q: cols('order_id', 'title'),
};
const columnsOf = (id: string) => columns[id];
const names = (s: { tables: Array<{ name: string }> }) => s.tables.map((t) => t.name);

describe('the canvas as a schema', () => {
  it('documents sources as tables, combining nodes as queries and the end of each Transform chain as a view', () => {
    const { schema } = canvasSchema(shop(), emptySchema(), columnsOf);
    expect(names(schema)).toEqual(['orders', 'clean', 'customers', 'products', 'j', 'q']);
    expect(schema.groups.map((g) => [g.name, g.tables.map((t) => t.name)])).toEqual([
      [CANVAS_GROUPS.table, ['orders', 'customers', 'products']],
      [CANVAS_GROUPS.query, ['j', 'q']],
      [CANVAS_GROUPS.view, ['clean']],
    ]);
    const table = (name: string) => schema.tables.find((t) => t.name === name)!;
    expect(table('orders').note).toBe('Source: orders.csv.');
    expect(table('orders').columns.map((c) => `${c.name} ${c.type}`)).toEqual(['order_id VARCHAR', 'customer_id VARCHAR', 'product_id VARCHAR']);
    expect(table('clean').note).toBe('View of orders: trim s1; case s2.');
    expect(table('j').note).toBe('Left join of clean and customers on customer_id = customer_id.');
    expect(table('q').note).toContain('Query of clean and products.');
    expect(table('q').note).toContain('JOIN products ON clean.product_id = products.id');
  });

  it('writes each relationship as a ref between the tables the columns come from, one or many as checked', () => {
    const unique = { clean: { customer_id: false, product_id: true }, customers: { customer_id: true }, products: { id: true } };
    const { schema } = canvasSchema(shop(), emptySchema(), columnsOf, unique);
    expect(schema.refs.map((r) => `${r.from.table}.${r.from.columns[0]} ${r.op} ${r.to.table}.${r.to.columns[0]}`)).toEqual(['orders.customer_id > customers.customer_id', 'orders.product_id - products.id']);
    expect(schema.tables.find((t) => t.name === 'customers')!.columns.find((c) => c.name === 'customer_id')!.unique).toBe(true);
  });

  it('carries a relationship drawn in the Relationships view (a referential rule) as a ref', () => {
    const p = shop();
    const rule: Rule = { id: 'r1', type: 'referential', label: 'Every id exists', enabled: true, severity: 'fail', params: { column: 'name', node: 'products', nodeColumn: 'title' } };
    const withRule = { ...p, nodes: p.nodes.map((n) => (n.id === 'customers' ? { ...n, rules: [rule] } : n)) };
    const { schema } = canvasSchema(withRule, emptySchema(), columnsOf);
    expect(schema.refs.map((r) => `${r.from.table}.${r.from.columns[0]} ${r.op} ${r.to.table}.${r.to.columns[0]}`)).toContain('customers.name > products.title');
  });

  it('says when a node’s columns aren’t known yet', () => {
    const { schema } = canvasSchema(shop(), emptySchema(), () => undefined);
    const orders = schema.tables.find((t) => t.name === 'orders')!;
    expect(orders.columns).toEqual([]);
    expect(orders.note).toContain('columns aren’t known yet');
  });

  it('leaves a node to the DBML table of its name, refs and all, and doesn’t repeat a ref the DBML has', () => {
    const designed = parseDbml('Table customers {\n  customer_id varchar [pk]\n}\nTable orders {\n  customer_id varchar [ref: > customers.customer_id]\n}').schema;
    const { schema, nodeOf, derived } = canvasSchema(shop(), designed, columnsOf);
    expect(names(schema)).toEqual(['clean', 'products', 'j', 'q']);
    expect(nodeOf.get('table:public.customers')).toBe('customers');
    expect(derived.has('table:public.customers')).toBe(false);
    expect(derived.has('table:public.clean')).toBe(true);
    // The DBML relates orders to customers already; products is the canvas's own.
    expect(schema.refs.map((r) => `${r.from.table}.${r.from.columns[0]} ${r.to.table}.${r.to.columns[0]}`)).toEqual(['orders.product_id products.id']);
  });

  it('documents a Schema table node by its table, and names two nodes of one name apart', () => {
    const p = flow({
      sources: [src({ id: 'a', format: 'csv' })],
      nodes: [
        { id: 's1', type: 'source', sourceId: 'a' },
        { id: 's2', type: 'source', sourceId: 'a' },
        { id: 't', type: 'table', tableSpec: { table: 'people' } },
      ],
    });
    const twins = { ...p, nodes: p.nodes.map((n) => (n.type === 'source' ? { ...n, name: 'Sales' } : n)) };
    const designed = parseDbml('Table people {\n  id int\n}').schema;
    const { schema, nodeOf } = canvasSchema(twins, designed, () => cols('id'));
    expect(names(schema)).toEqual(['Sales', 'Sales 2']);
    expect(nodeOf.get('table:public.people')).toBe('t');
  });

  it('merges after the DBML’s own tables, refs and groups', () => {
    const designed = parseDbml('Table people {\n  id int\n}').schema;
    const canvas = canvasSchema(shop(), designed, columnsOf).schema;
    const merged = withCanvas(designed, canvas);
    expect(names(merged)).toEqual(['people', ...names(canvas)]);
    expect(merged.refs).toHaveLength(canvas.refs.length);
    expect(withCanvas(designed, emptySchema())).toBe(designed);
  });
});
