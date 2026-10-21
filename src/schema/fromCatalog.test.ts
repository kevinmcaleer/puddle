// The catalogue-to-schema conversion on the catalogues the SQLite and DuckDB drivers record for the shop fixtures
// (tests/fixtures/db/<driver>/catalog.json, kept in step by tests/engine/document.test.ts), and documenting into
// DBML that already has the user's own text.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CatalogDetail } from '../connect/types';
import { defaultFrom, documentDiff, documentedPart, documentedTable, documentInto, documentSchemaName, removeDocumented, schemaFromCatalog } from './fromCatalog';
import { parseDbml } from './parse';
import { writeDbml } from './write';

const catalog = (driver: 'sqlite' | 'duckdb'): CatalogDetail => JSON.parse(readFileSync(`tests/fixtures/db/${driver}/catalog.json`, 'utf8'));

const OWN = `// The user's own design.
Table people {
  id int [pk]
  status person_status
}

Enum person_status {
  active
  gone
}

Note sticky {
  'Keep this'
}
`;

describe('schemaFromCatalog', () => {
  it('turns the SQLite shop into tables, a ref, a view with its SQL and a group named after the connection', () => {
    const s = schemaFromCatalog(catalog('sqlite'), { group: 'Shop', note: 'Documented from SQLite connection Shop on 2026-10-21' });
    expect(s.tables.map((t) => `${t.schema}.${t.name}`)).toEqual(['public.customers', 'public.orders', 'public.order_totals']);
    const customers = s.tables[0]!;
    expect(customers.columns.map((c) => [c.name, c.type, c.pk, c.unique, c.notNull ?? null, c.default ?? null])).toEqual([
      ['id', 'INTEGER', true, false, null, null],
      ['name', 'TEXT', false, false, true, null],
      ['email', 'TEXT', false, true, null, null],
      ['signed_up', 'DATE', false, false, null, null],
      ['active', 'BOOLEAN', false, false, null, { kind: 'number', value: '1' }],
    ]);
    expect(s.tables[1]!.indexes).toEqual([{ parts: [{ kind: 'column', value: 'customer_id' }], unique: false, pk: false, name: 'orders_customer' }]);
    expect(s.refs).toEqual([{ from: { schema: 'public', table: 'orders', columns: ['customer_id'] }, to: { schema: 'public', table: 'customers', columns: ['id'] }, op: '>', fromOptional: false, toOptional: false, inactive: false, inline: false }]);
    expect(s.tables[2]!.note).toMatch(/^View, defined as:\nCREATE VIEW order_totals AS SELECT/);
    expect(s.groups).toEqual([{ name: 'Shop', tables: s.tables.map((t) => ({ schema: 'public', name: t.name })), properties: {}, note: 'Documented from SQLite connection Shop on 2026-10-21' }]);
    expect(s.enums).toEqual([]);
    // What it writes parses back the same.
    const dbml = writeDbml(s);
    const back = parseDbml(dbml);
    expect(back.errors).toEqual([]);
    expect(back.schema.refs).toHaveLength(1);
    expect(back.schema.groups[0]!.tables).toHaveLength(3);
  });

  it('keeps the DuckDB shop’s enum, boolean default and index', () => {
    const s = schemaFromCatalog(catalog('duckdb'), { group: 'Shop file' });
    expect(s.enums).toEqual([{ schema: 'public', name: 'order_status', values: [{ name: 'placed' }, { name: 'shipped' }, { name: 'returned' }] }]);
    expect(s.tables[0]!.columns.find((c) => c.name === 'active')!.default).toEqual({ kind: 'boolean', value: 'true' });
    expect(s.tables[0]!.columns.find((c) => c.name === 'email')!.unique).toBe(true);
    expect(s.tables[1]!.indexes[0]).toMatchObject({ name: 'orders_customer', parts: [{ kind: 'column', value: 'customer_id' }] });
    expect(s.tables[1]!.columns.find((c) => c.name === 'total')!.type).toBe('DECIMAL(10,2)');
    expect(parseDbml(writeDbml(s)).errors).toEqual([]);
  });

  it('puts tables in the database’s own schemas, drops a foreign key to a table it can’t see, and fills in a reference to the parent’s key', () => {
    const detail: CatalogDetail = {
      tables: [
        { schema: 'sales', name: 'orders', kind: 'table', columns: [{ name: 'id', type: 'int', pk: true, unique: false, notNull: true, increment: true }, { name: 'customer_id', type: 'int', pk: false, unique: false, notNull: false, increment: false }, { name: 'shop_id', type: 'int', pk: false, unique: false, notNull: false, increment: false }], indexes: [], foreignKeys: [{ columns: ['customer_id'], refSchema: 'crm', refTable: 'customers', refColumns: [''] }, { columns: ['shop_id'], refTable: 'shops', refColumns: ['id'] }] },
        { schema: 'crm', name: 'customers', kind: 'table', columns: [{ name: 'id', type: 'int', pk: true, unique: false, notNull: true, increment: false }], indexes: [], foreignKeys: [] },
      ],
      enums: [{ schema: 'crm', name: 'tier', values: ['gold'] }],
    };
    const s = schemaFromCatalog(detail, { group: 'Warehouse' });
    expect(s.tables.map((t) => `${t.schema}.${t.name}`)).toEqual(['sales.orders', 'crm.customers']);
    expect(s.refs.map((r) => `${r.from.schema}.${r.from.table}.${r.from.columns} > ${r.to.schema}.${r.to.table}.${r.to.columns}`)).toEqual(['sales.orders.customer_id > crm.customers.id']);
    expect(s.tables[0]!.columns[0]).toMatchObject({ increment: true, pk: true });
    expect(s.enums[0]!.schema).toBe('crm');
  });

  it('reads defaults as the database wrote them', () => {
    expect(defaultFrom('0')).toEqual({ kind: 'number', value: '0' });
    expect(defaultFrom("'it''s'")).toEqual({ kind: 'string', value: "it's" });
    expect(defaultFrom('TRUE')).toEqual({ kind: 'boolean', value: 'true' });
    expect(defaultFrom('NULL')).toEqual({ kind: 'null', value: 'null' });
    expect(defaultFrom('CURRENT_TIMESTAMP')).toEqual({ kind: 'expression', value: 'CURRENT_TIMESTAMP' });
    expect(defaultFrom('  ')).toBeUndefined();
  });
});

describe('documenting into the project’s DBML', () => {
  const shop = () => schemaFromCatalog(catalog('sqlite'), { group: 'Shop', note: 'Documented from SQLite connection Shop on 2026-10-21' });

  it('appends the group after the user’s own text, and documenting again replaces only what the group held', () => {
    const once = documentInto(OWN, shop(), 'Shop');
    expect(once.startsWith(OWN.trimEnd())).toBe(true);
    const parsed = parseDbml(once);
    expect(parsed.errors).toEqual([]);
    expect(parsed.schema.tables.map((t) => t.name)).toEqual(['people', 'customers', 'orders', 'order_totals']);
    expect(parsed.schema.groups.map((g) => g.name)).toEqual(['Shop']);

    // The database changed: a column went, a table came.
    const changed = catalog('sqlite');
    changed.tables[0]!.columns = changed.tables[0]!.columns.filter((c) => c.name !== 'email');
    changed.tables.push({ name: 'returns', kind: 'table', columns: [{ name: 'id', type: 'INTEGER', pk: true, unique: false, notNull: true, increment: false }], indexes: [], foreignKeys: [] });
    const generated = schemaFromCatalog(changed, { group: 'Shop' });
    const twice = documentInto(once, generated, 'Shop');
    const again = parseDbml(twice);
    expect(again.errors).toEqual([]);
    expect(again.schema.tables.map((t) => t.name)).toEqual(['people', 'customers', 'orders', 'order_totals', 'returns']);
    expect(again.schema.groups).toHaveLength(1);
    expect(again.schema.refs).toHaveLength(1);
    expect(again.schema.enums.map((e) => e.name)).toEqual(['person_status']);
    expect(again.schema.notes[0]!.text).toBe('Keep this');
    expect(twice).toContain("// The user's own design.");
    expect(twice.match(/Table customers/g)).toHaveLength(1);
    expect(twice).not.toContain('email');
  });

  it('tells what changed since the last documenting', () => {
    const once = documentInto(OWN, shop(), 'Shop');
    const before = documentedPart(parseDbml(once).schema, 'Shop')!;
    expect(before.tables).toHaveLength(3);
    expect(before.refs).toHaveLength(1);
    expect(before.enums).toEqual([]);
    const changed = catalog('sqlite');
    changed.tables[1]!.columns.push({ name: 'note', type: 'TEXT', pk: false, unique: false, notNull: false, increment: false });
    const diff = documentDiff(before, schemaFromCatalog(changed, { group: 'Shop', note: 'Documented from SQLite connection Shop on 2026-10-22' }));
    expect(diff.changes.map((c) => c.text)).toEqual(['Added column "note" (TEXT)']);
    expect(documentedPart(parseDbml(OWN).schema, 'Shop')).toBeNull();
  });

  it('takes the group’s own enums with it and leaves one another table uses', () => {
    const detail: CatalogDetail = {
      tables: [{ name: 'orders', kind: 'table', columns: [{ name: 'status', type: 'order_status', pk: false, unique: false, notNull: false, increment: false }, { name: 'tier', type: 'person_status', pk: false, unique: false, notNull: false, increment: false }], indexes: [], foreignKeys: [] }],
      enums: [{ name: 'order_status', values: ['placed'] }],
    };
    const once = documentInto(OWN, schemaFromCatalog(detail, { group: 'Shop' }), 'Shop');
    expect(parseDbml(once).schema.enums.map((e) => e.name)).toEqual(['person_status', 'order_status']);
    const removed = removeDocumented(once, 'Shop');
    expect(parseDbml(removed).schema.enums.map((e) => e.name)).toEqual(['person_status']);
    expect(removed.trim()).toBe(OWN.trim());
  });

  it('moves the tables to a schema named after the connection when one would clash with the user’s own', () => {
    const detail: CatalogDetail = { tables: [{ name: 'people', kind: 'table', columns: [], indexes: [], foreignKeys: [] }], enums: [] };
    expect(documentSchemaName(OWN, 'My Shop', detail)).toBe('my_shop');
    expect(documentSchemaName(OWN, 'Shop', catalog('sqlite'))).toBe('public');
    // Its own earlier documenting is no clash.
    const once = documentInto(OWN, schemaFromCatalog(catalog('sqlite'), { group: 'Shop' }), 'Shop');
    expect(documentSchemaName(once, 'Shop', catalog('sqlite'))).toBe('public');
    const s = schemaFromCatalog(detail, { group: 'My Shop', schema: 'my_shop' });
    expect(parseDbml(documentInto(OWN, s, 'My Shop')).schema.tables.map((t) => `${t.schema}.${t.name}`)).toEqual(['public.people', 'my_shop.people']);
  });

  it('finds the documented table a source reads', () => {
    const once = documentInto(OWN, shop(), 'Shop');
    expect(documentedTable(once, 'Shop', { name: 'orders' })).toEqual({ schema: 'public', table: 'orders' });
    expect(documentedTable(once, 'Shop', { name: 'people' })).toBeUndefined();
    expect(documentedTable(once, 'Other', { name: 'orders' })).toBeUndefined();
  });
});
