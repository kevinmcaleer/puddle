import { toDbml } from './dbml';
import type { Relationship, RelTable } from './model';

const tables: RelTable[] = [
  { nodeId: 'o', name: 'orders', kind: 'source', columns: [{ name: 'order_id', type: 'BIGINT' }, { name: 'customer_id', type: 'BIGINT' }, { name: 'total', type: 'DECIMAL(10,2)' }, { name: 'placed "at"', type: 'TIMESTAMP WITH TIME ZONE' }] },
  { nodeId: 'c', name: 'customers', kind: 'source', columns: [{ name: 'customer_id', type: 'BIGINT' }, { name: 'tags', type: 'VARCHAR[]' }] },
  { nodeId: 'c2', name: 'Customers', kind: 'transform' },
];
const rel = (from: string, fromCol: string, to: string, toCol: string): Relationship => ({ key: `${from}${to}`, from: { nodeId: from, column: fromCol }, to: { nodeId: to, column: toCol }, read: { from: { nodeId: from, column: fromCol }, to: { nodeId: to, column: toCol } }, via: [{ nodeId: 'j', kind: 'join', label: 'Join 1' }] });

describe('DBML', () => {
  it('writes each table with its columns and types, and each relationship as a ref', () => {
    const dbml = toDbml({ name: 'Shop' }, tables, [rel('o', 'customer_id', 'c', 'customer_id')], { o: { customer_id: false }, c: { customer_id: true } });
    expect(dbml).toBe(
      [
        '// Shop: tables and relationships from Puddle',
        '',
        'Table "orders" {',
        '  "order_id" BIGINT',
        '  "customer_id" BIGINT',
        '  "total" DECIMAL(10,2)',
        '  "placed \\"at\\"" "TIMESTAMP WITH TIME ZONE"',
        '}',
        '',
        'Table "customers" {',
        '  "customer_id" BIGINT [unique]',
        '  "tags" VARCHAR[]',
        '}',
        '',
        'Table "Customers 2" {',
        '  // Columns not known yet: the node is still being read, or can’t run.',
        '}',
        '',
        'Ref: "orders"."customer_id" > "customers"."customer_id" // Join 1',
        '',
      ].join('\n'),
    );
  });

  it('turns the ref round for one-to-many, and writes one-to-one and many-to-many', () => {
    const ref = (u: Record<string, Record<string, boolean>>) => toDbml({ name: 'p' }, tables, [rel('o', 'customer_id', 'c', 'customer_id')], u).split('\n').find((l) => l.startsWith('Ref'));
    expect(ref({ o: { customer_id: true }, c: { customer_id: false } })).toContain('"customer_id" < "customers"');
    expect(ref({ o: { customer_id: true }, c: { customer_id: true } })).toContain('"customer_id" - "customers"');
    expect(ref({ o: { customer_id: false }, c: { customer_id: false } })).toContain('"customer_id" <> "customers"');
    expect(ref({})).toContain('"customer_id" > "customers"');
  });
});
