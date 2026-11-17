import { flow } from '../../tests/helpers/projects';
import type { CatalogTable, Connection, Project, Source } from '../model';
import { databasePairs, guessForeignKeys, singular } from './database';
import { findRelationships } from './model';
import { staleCatalog } from './useRelationships';

const t = (name: string, columns: string[], extra: Partial<CatalogTable> = {}): CatalogTable => ({
  name,
  kind: 'table',
  columns: columns.map((c) => (c.startsWith('*') ? { name: c.slice(1), type: 'BIGINT', key: true } : { name: c, type: 'VARCHAR' })),
  ...extra,
});

const source = (id: string, connectionId: string, table: string): Source => ({ id, name: table, kind: 'connection', connection: { connectionId, table: { name: table }, columns: [] }, format: 'connection', parseOptions: {}, detectedSchema: [] });

/** A SQLite connection with these catalogue tables, and a source node reading each of `read`. */
function project(tables: CatalogTable[], read: string[]): Project {
  const p = flow({ sources: read.map((r) => source(`s_${r}`, 'c1', r)), nodes: read.map((r) => ({ id: r, type: 'source' as const, sourceId: `s_${r}` })) });
  const connection: Connection = { id: 'c1', name: 'shop', driver: 'sqlite', via: 'browser', settings: { file: 'shop.sqlite' }, auth: 'none', catalog: { tables } };
  return { ...p, connections: [connection] };
}

const pairs = (p: Project) => databasePairs(p).map((x) => `${x.from.nodeId}.${x.from.column} > ${x.to.nodeId}.${x.to.column} (${x.kind})`);

describe('relationships a database states', () => {
  const declared = [
    t('customers', ['*id', 'name'], { foreignKeys: [] }),
    t('orders', ['*id', 'customer_id', 'product_id'], { foreignKeys: [{ columns: ['customer_id'], refTable: 'customers', refColumns: ['id'] }] }),
    t('products', ['*id', 'title'], { foreignKeys: [] }),
  ];

  it('draws a declared foreign key between the sources reading both tables, and only the declared ones', () => {
    expect(pairs(project(declared, ['customers', 'orders', 'products']))).toEqual(['orders.customer_id > customers.id (database)']);
    // orders.product_id matches products by name, but the file declares its keys, so no guess is added.
    const rels = findRelationships(project(declared, ['customers', 'orders', 'products']), () => undefined);
    expect(rels.map((r) => r.via.map((v) => [v.kind, v.label]))).toEqual([[['database', 'Foreign key in shop']]]);
  });

  it('draws nothing until both tables are read', () => {
    expect(pairs(project(declared, ['orders']))).toEqual([]);
    expect(pairs(project(declared, ['orders', 'products']))).toEqual([]);
  });

  it('guesses from the column names when the database declares no foreign keys', () => {
    const bare = [
      t('customers', ['*id', 'name'], { foreignKeys: [] }),
      t('orders', ['*id', 'CustomerID', 'product_code'], { foreignKeys: [] }),
      t('products', ['*product_code', 'title'], { foreignKeys: [] }),
      t('categories', ['*id', 'label'], { foreignKeys: [] }),
      t('items', ['*id', 'category_id', 'orders_id'], { foreignKeys: [] }),
    ];
    expect(pairs(project(bare, ['customers', 'orders', 'products', 'categories', 'items']))).toEqual([
      'orders.CustomerID > customers.id (guess)',
      'items.orders_id > orders.id (guess)',
      'orders.product_code > products.product_code (guess)',
      'items.category_id > categories.id (guess)',
    ]);
    const [first] = findRelationships(project(bare, ['customers', 'orders']), () => undefined);
    expect(first!.via).toEqual([{ nodeId: 'orders', kind: 'guess', label: 'Guessed from the column names' }]);
  });

  it('guesses nothing where the driver can’t say whether foreign keys are declared', () => {
    const unknown = [t('customers', ['*id', 'name']), t('orders', ['*id', 'customer_id'])];
    expect(pairs(project(unknown, ['customers', 'orders']))).toEqual([]);
  });

  it('takes a column named id as the key when the catalogue marks none, and never matches a table’s own id', () => {
    const tables = [t('people', ['id', 'name'], { foreignKeys: [] }), t('pets', ['id', 'person_id'], { foreignKeys: [] })];
    expect(guessForeignKeys(tables).map((g) => `${g.table.name}.${g.column} > ${g.parent.name}.${g.key}`)).toEqual([]);
    expect(singular('people')).toBe('people');
    const owners = [t('owners', ['id', 'name'], { foreignKeys: [] }), t('pets', ['id', 'owner_id'], { foreignKeys: [] })];
    expect(guessForeignKeys(owners).map((g) => `${g.table.name}.${g.column} > ${g.parent.name}.${g.key}`)).toEqual(['pets.owner_id > owners.id']);
  });

  it('makes plural table names singular', () => {
    expect(['customers', 'categories', 'boxes', 'addresses', 'status', 'staff'].map(singular)).toEqual(['customer', 'category', 'box', 'address', 'status', 'staff']);
  });

  it('reads a SQLite catalogue again when it was kept before foreign keys were read', () => {
    const c = project([t('orders', ['*id'])], []).connections[0]!;
    expect(staleCatalog(c)).toBe(true);
    expect(staleCatalog({ ...c, catalog: { tables: [t('orders', ['*id'], { foreignKeys: [] })] } })).toBe(false);
    // A view lists no foreign keys of its own; another driver's catalogue never had them.
    expect(staleCatalog({ ...c, catalog: { tables: [t('totals', ['n'], { kind: 'view' })] } })).toBe(false);
    expect(staleCatalog({ ...c, driver: 'postgres' })).toBe(false);
  });
});
