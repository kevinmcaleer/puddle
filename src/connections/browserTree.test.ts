import type { Catalog } from '../model';
import { buildTree, countLabel, filterTree } from './browserTree';

const col = (name: string, type = 'VARCHAR') => ({ name, type, nullable: true });
const catalog: Catalog = {
  tables: [
    { schema: 'sales', name: 'orders', kind: 'table', columns: [col('id', 'BIGINT'), col('customer_id', 'BIGINT'), col('total', 'DOUBLE')], rows: 4 },
    { name: 'order_totals', kind: 'view', columns: [col('name'), col('orders', 'BIGINT')] },
    { name: 'customers', kind: 'table', columns: [col('id', 'BIGINT'), col('email')], rows: 3 },
    { schema: 'audit', name: 'log', kind: 'table', columns: [col('at', 'TIMESTAMP')] },
    { name: 'archive', kind: 'table', columns: [] },
  ],
};

describe('the database browser tree', () => {
  it('groups tables by schema, the default schema first, tables before views, each by name', () => {
    expect(buildTree(catalog).map((g) => [g.schema, g.tables.map((t) => t.name)])).toEqual([
      [undefined, ['archive', 'customers', 'order_totals']],
      ['audit', ['log']],
      ['sales', ['orders']],
    ]);
    expect(buildTree(undefined)).toEqual([]);
  });

  it('filters by table name with its schema, or by a column name, every word matching', () => {
    const tree = buildTree(catalog);
    const names = (s: string) => filterTree(tree, s).flatMap((g) => g.tables.map((t) => (g.schema ? `${g.schema}.${t.name}` : t.name)));
    expect(filterTree(tree, '  ')).toBe(tree);
    expect(names('order')).toEqual(['order_totals', 'sales.orders']);
    expect(names('email')).toEqual(['customers']);
    expect(names('sales.ord')).toEqual(['sales.orders']);
    expect(names('orders total')).toEqual(['order_totals', 'sales.orders']);
    expect(names('nothing')).toEqual([]);
    // A matching table keeps all its columns.
    expect(filterTree(tree, 'email')[0]!.tables[0]!.columns).toHaveLength(2);
  });

  it('counts tables and views for the heading', () => {
    expect(countLabel(catalog)).toBe('4 tables, 1 view');
    expect(countLabel({ tables: [catalog.tables[2]!] })).toBe('1 table');
    expect(countLabel(undefined)).toBe('0 tables');
  });
});
