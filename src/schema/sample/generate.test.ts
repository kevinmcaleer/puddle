// The sample row generator: seeded, and every key, check, enum, length and ref of the schema kept.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DbmlSchema, RecordValue } from '../model';
import { parseDbml } from '../parse';
import { readCheck } from './checks';
import { generateRows, type GeneratedRows, type GeneratedTable } from './generate';
import { mulberry32 } from './random';

const T = (name: string) => `table:public.${name}`;
const shopText = readFileSync(join(__dirname, '../../../tests/fixtures/dbml/shop.dbml'), 'utf8');

function parse(text: string): DbmlSchema {
  const { schema, errors } = parseDbml(text);
  expect(errors).toEqual([]);
  return schema;
}

const table = (g: GeneratedRows, name: string): GeneratedTable => {
  const t = g.tables.find((x) => x.table === name);
  if (!t) throw new Error(`No rows for ${name}`);
  return t;
};
/** One column's values. */
const column = (t: GeneratedTable, name: string): RecordValue[] => {
  const i = t.columns.indexOf(name);
  expect(i).toBeGreaterThanOrEqual(0);
  return t.rows.map((r) => r[i]!);
};
const values = (t: GeneratedTable, name: string) => column(t, name).map((v) => v.value);
const nonNull = (t: GeneratedTable, name: string) => column(t, name).filter((v) => v.kind !== 'null');

describe('the random stream', () => {
  it('repeats for a seed and differs between seeds', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('generating sample rows', () => {
  const shop = parse(shopText);
  const all = shop.tables.map((t) => T(t.name));

  it('gives the same rows for the same seed and different rows for another', () => {
    const one = generateRows(shop, all, { rows: 20, seed: 1 });
    expect(generateRows(shop, all, { rows: 20, seed: 1 })).toEqual(one);
    expect(generateRows(shop, all, { rows: 20, seed: 2 }).tables).not.toEqual(one.tables);
  });

  it('makes 100 rows for every table of the shop, parents first, with nothing to note', () => {
    const g = generateRows(shop, all, { rows: 100, seed: 42 });
    expect(g.notes).toEqual([]);
    expect(g.added).toEqual([]);
    const order = g.tables.map((t) => t.table);
    expect(order.indexOf('customers')).toBeLessThan(order.indexOf('orders'));
    expect(order.indexOf('orders')).toBeLessThan(order.indexOf('order_items'));
    expect(order.indexOf('products')).toBeLessThan(order.indexOf('order_items'));
    for (const t of g.tables) expect(t.rows).toHaveLength(100);
    // created_at defaults to now(): left for the database to fill.
    expect(table(g, 'customers').columns).toEqual(['id', 'email', 'name', 'country']);
  });

  it('numbers keys in order, keeps unique and not null columns so, and composite keys unique as a pair', () => {
    const g = generateRows(shop, all, { rows: 100, seed: 3 });
    const customers = table(g, 'customers');
    expect(values(customers, 'id')).toEqual(Array.from({ length: 100 }, (_, i) => String(i + 1)));
    expect(new Set(values(customers, 'email')).size).toBe(100);
    for (const c of ['email', 'name']) expect(column(customers, c).every((v) => v.kind === 'string' && v.value)).toBe(true);
    const items = table(g, 'order_items');
    const pairs = items.rows.map((r) => `${r[0]!.value}/${r[1]!.value}`);
    expect(new Set(pairs).size).toBe(100);
    expect(new Set(values(table(g, 'products'), 'sku')).size).toBe(100);
  });

  it('leaves nullable columns null now and then, but never a key', () => {
    const s = parse('Table t {\n  id int [pk]\n  code varchar [unique]\n  maybe int\n}');
    const t = table(generateRows(s, [T('t')], { rows: 200, seed: 5 }), 't');
    const nulls = column(t, 'maybe').filter((v) => v.kind === 'null').length;
    expect(nulls).toBeGreaterThan(0);
    expect(nulls).toBeLessThan(60);
    expect(column(t, 'code').some((v) => v.kind === 'null')).toBe(false);
    expect(column(t, 'id').some((v) => v.kind === 'null')).toBe(false);
  });

  it('draws enum columns from the enum’s values', () => {
    const orders = table(generateRows(shop, [T('orders')], { rows: 100, seed: 9 }), 'orders');
    const status = column(orders, 'status');
    expect(status.every((v) => v.kind === 'enum' && /^order_status\.(pending|paid|shipped|cancelled)$/.test(v.value))).toBe(true);
    expect(new Set(status.map((v) => v.value)).size).toBeGreaterThan(1);
  });

  it('follows simple checks on columns and tables, and notes the ones it can’t', () => {
    const s = parse(`Table t {
  id int [pk]
  score int [check: \`score between 10 and 20\`]
  level int [not null, check: \`level > 5\`, check: \`level <= 7\`]
  size varchar [not null, check: \`size in ('S', 'M', 'L')\`]
  ratio decimal(4,2) [not null]
  wealth int [not null]
  debt int [not null]
  checks {
    \`ratio >= 0 and ratio < 1\`
    \`debt + wealth >= 0\`
  }
}`);
    const g = generateRows(s, [T('t')], { rows: 100, seed: 11 });
    const t = table(g, 't');
    expect(nonNull(t, 'score').every((v) => +v.value >= 10 && +v.value <= 20)).toBe(true);
    expect(values(t, 'level').every((v) => ['6', '7'].includes(v))).toBe(true);
    expect(new Set(values(t, 'size'))).toEqual(new Set(['S', 'M', 'L']));
    expect(values(t, 'ratio').every((v) => +v >= 0 && +v < 1 && /^\d\.\d\d$/.test(v))).toBe(true);
    expect(g.notes).toEqual(['The check `debt + wealth >= 0` on t isn’t one sample rows can follow, so some rows may break it.']);
  });

  it('reads the checks it can follow', () => {
    expect(readCheck('total >= 0')).toEqual([{ column: 'total', bound: { min: 0 } }]);
    expect(readCheck('(0 < "my col")')).toEqual([{ column: 'my col', bound: { min: 0, minExclusive: true } }]);
    expect(readCheck('a between 1 and 5 and b in (1, 2)')).toEqual([
      { column: 'a', bound: { min: 1, max: 5 } },
      { column: 'b', bound: { values: [{ kind: 'number', value: '1' }, { kind: 'number', value: '2' }] } },
    ]);
    expect(readCheck('length(name) > 2')).toBeUndefined();
    expect(readCheck('a > 1 or b > 1')).toBeUndefined();
  });

  it('keeps text within its length, char(n) at n, and decimals at their scale', () => {
    const s = parse('Table t {\n  id int [pk]\n  short varchar(5) [not null]\n  email varchar(12) [unique, not null]\n  flag char(3) [not null]\n  country char(2) [not null]\n  price decimal(6,3) [not null]\n}');
    const t = table(generateRows(s, [T('t')], { rows: 100, seed: 4 }), 't');
    expect(values(t, 'short').every((v) => v.length > 0 && v.length <= 5)).toBe(true);
    expect(values(t, 'email').every((v) => v.length <= 12)).toBe(true);
    expect(new Set(values(t, 'email')).size).toBe(100);
    expect(values(t, 'flag').every((v) => /^[A-Z]{3}$/.test(v))).toBe(true);
    expect(values(t, 'country').every((v) => /^[A-Z]{2}$/.test(v))).toBe(true);
    expect(values(t, 'price').every((v) => /^\d{1,3}\.\d{3}$/.test(v) && +v > 0)).toBe(true);
  });

  it('makes each type’s values in a form DuckDB reads', () => {
    const s = parse(`Table t {
  id bigint [pk]
  b boolean [not null]
  d date [not null]
  tm time [not null]
  ts timestamp [not null]
  tz timestamptz [not null]
  u uuid [not null]
  j json [not null]
  f float [not null]
  odd geometry [not null]
}`);
    const t = table(generateRows(s, [T('t')], { rows: 20, seed: 6 }), 't');
    expect(column(t, 'b').every((v) => v.kind === 'boolean')).toBe(true);
    expect(values(t, 'd').every((v) => /^202[345]-\d\d-\d\d$/.test(v))).toBe(true);
    expect(values(t, 'tm').every((v) => /^\d\d:\d\d:\d\d$/.test(v))).toBe(true);
    expect(values(t, 'ts').every((v) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v))).toBe(true);
    expect(values(t, 'tz').every((v) => v.endsWith('+00'))).toBe(true);
    expect(values(t, 'u').every((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v))).toBe(true);
    expect(values(t, 'j').every((v) => typeof JSON.parse(v) === 'object')).toBe(true);
    expect(column(t, 'f').every((v) => v.kind === 'number')).toBe(true);
    expect(values(t, 'odd').every((v) => v.length > 0)).toBe(true);
  });

  it('steers values by column name', () => {
    const s = parse(`Table people {
  id int [pk]
  Email varchar [not null]
  firstName varchar [not null]
  last_name varchar [not null]
  city varchar [not null]
  country varchar [not null]
  phone varchar [not null]
  website varchar [not null]
  bio text [not null]
  quantity int [not null]
  total decimal(8,2) [not null]
  updated_at varchar [not null]
  zip varchar [not null]
  street varchar [not null]
  status varchar [not null]
}`);
    const t = table(generateRows(s, [T('people')], { rows: 50, seed: 8 }), 'people');
    expect(values(t, 'Email').every((v) => /^[a-z]+\.[a-z]+@[a-z.]+\.(com|org|net)$/.test(v))).toBe(true);
    expect(values(t, 'firstName').every((v) => /^[A-Z][a-z]+$/.test(v))).toBe(true);
    expect(values(t, 'last_name').every((v) => /^[A-Z][a-z]+$/.test(v))).toBe(true);
    expect(values(t, 'city').every((v) => /^[A-Z]/.test(v))).toBe(true);
    expect(values(t, 'country').some((v) => v.length > 3)).toBe(true);
    expect(values(t, 'phone').every((v) => /^\+44 7700 900\d{3}$/.test(v))).toBe(true);
    expect(values(t, 'website').every((v) => v.startsWith('https://'))).toBe(true);
    expect(values(t, 'bio').every((v) => /^[A-Z].* .*\.$/.test(v))).toBe(true);
    expect(values(t, 'quantity').every((v) => +v >= 1 && +v <= 10)).toBe(true);
    expect(values(t, 'total').every((v) => +v >= 1 && +v <= 500)).toBe(true);
    expect(values(t, 'updated_at').every((v) => /^202[345]-/.test(v))).toBe(true);
    expect(values(t, 'zip').every((v) => /^\d{5}$/.test(v))).toBe(true);
    expect(values(t, 'street').every((v) => /^\d+ [A-Z][a-z]+ [A-Z][a-z]+$/.test(v))).toBe(true);
    expect(values(t, 'status').every((v) => v.length > 0)).toBe(true);
    // A product's name is a product, a customer's a person.
    const g = generateRows(shop, [T('products'), T('customers')], { rows: 20, seed: 8 });
    expect(values(table(g, 'products'), 'name').every((v) => !/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(v))).toBe(true);
    expect(values(table(g, 'customers'), 'name').every((v) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(v))).toBe(true);
  });

  it('points every foreign key at a parent row, generating parents with no rows and listing them', () => {
    const g = generateRows(shop, [T('order_items')], { rows: 100, seed: 12 });
    expect(g.added).toEqual([T('orders'), T('products'), T('customers')]);
    expect(g.tables.map((t) => t.table)).toEqual(['customers', 'orders', 'products', 'order_items']);
    const ids = (name: string) => new Set(values(table(g, name), 'id'));
    expect(values(table(g, 'orders'), 'customer_id').every((v) => ids('customers').has(v))).toBe(true);
    expect(values(table(g, 'order_items'), 'order_id').every((v) => ids('orders').has(v))).toBe(true);
    expect(values(table(g, 'order_items'), 'product_id').every((v) => ids('products').has(v))).toBe(true);
  });

  it('uses existing records as parents and numbers keys after them', () => {
    const s = parse(`${shopText}
records customers(id, email, name) {
  7, 'ada@example.com', 'Ada'
  9, 'bob@example.com', 'Bob'
}
records orders(id, customer_id, status, total, ordered_at) [example] {
  500, 7, 'paid', 1, '2024-01-01'
}`);
    const g = generateRows(s, [T('orders'), T('customers')], { rows: 10, seed: 1 });
    expect(g.added).toEqual([]);
    expect(values(table(g, 'customers'), 'id')).toEqual(['10', '11', '12', '13', '14', '15', '16', '17', '18', '19']);
    expect(values(table(g, 'customers'), 'email')).not.toContain('ada@example.com');
    // Example records aren't in the table, so their key isn't skipped.
    expect(values(table(g, 'orders'), 'id')[0]).toBe('1');
    const parents = new Set(['7', '9', ...values(table(g, 'customers'), 'id')]);
    expect(values(table(g, 'orders'), 'customer_id').every((v) => parents.has(v))).toBe(true);
    // A parent with rows of its own isn't generated when only the child is asked for.
    const only = generateRows(s, [T('orders')], { rows: 30, seed: 1 });
    expect(only.added).toEqual([]);
    expect(only.tables.map((t) => t.table)).toEqual(['orders']);
    expect(new Set(values(table(only, 'orders'), 'customer_id'))).toEqual(new Set(['7', '9']));
  });

  it('gives one-to-one refs distinct parents and self-references earlier rows', () => {
    const s = parse(`Table users {
  id int [pk]
}
Table profiles {
  id int [pk]
  user_id int [not null, ref: - users.id]
}
Table staff {
  id int [pk]
  manager_id int [ref: > staff.id]
}`);
    const g = generateRows(s, [T('profiles'), T('staff')], { rows: 20, seed: 2 });
    expect(new Set(values(table(g, 'profiles'), 'user_id')).size).toBe(20);
    const staff = table(g, 'staff');
    expect(column(staff, 'manager_id')[0]!.kind).toBe('null');
    staff.rows.forEach((row, i) => {
      if (row[1]!.kind !== 'null') expect(Number(row[1]!.value)).toBeLessThan(i + 1);
    });
    // Ten users can't each have a profile of their own for twenty profiles.
    const few = parse(`Table users {\n  id int [pk]\n}\nTable profiles {\n  id int [pk]\n  user_id int [not null, ref: - users.id]\n}\nrecords users(id) {\n${Array.from({ length: 10 }, (_, i) => `  ${i + 1}`).join('\n')}\n}`);
    const short = generateRows(few, [T('profiles')], { rows: 20, seed: 2 });
    expect(table(short, 'profiles').rows).toHaveLength(10);
    expect(short.notes).toEqual(['Only 10 of 20 rows were generated for profiles: each row needs a row of users of its own and there are only 10.']);
  });

  it('notes a unique column with too few values, and stops there', () => {
    const s = parse('Enum size {\n  small\n  large\n}\nTable t {\n  id int [pk]\n  flag boolean [unique, not null]\n}\nTable u {\n  id int [pk]\n  s size [unique, not null]\n}');
    const g = generateRows(s, [T('t'), T('u')], { rows: 10, seed: 3 });
    expect(table(g, 't').rows).toHaveLength(2);
    expect(table(g, 'u').rows).toHaveLength(2);
    expect(g.notes).toEqual([
      'Only 2 of 10 rows were generated for t: there aren’t enough different values for flag.',
      'Only 2 of 10 rows were generated for u: there aren’t enough different values for s.',
    ]);
  });

  it('generates for other schemas and composite refs', () => {
    const s = parse(`Enum v2.state {
  open
  "on hold"
}
Table v2.merchants {
  id int
  country_code char(2)
  state v2.state [not null]
  indexes {
    (id, country_code) [pk]
  }
}
Table v2.periods {
  merchant_id int [not null]
  country_code char(2) [not null]
  starts date
}
Ref: v2.periods.(merchant_id, country_code) > v2.merchants.(id, country_code)`);
    const g = generateRows(s, ['table:v2.periods'], { rows: 30, seed: 4 });
    expect(g.added).toEqual(['table:v2.merchants']);
    const merchants = table(g, 'merchants');
    const keys = new Set(merchants.rows.map((r) => `${r[0]!.value}/${r[1]!.value}`));
    expect(keys.size).toBe(30);
    expect(table(g, 'periods').rows.every((r) => keys.has(`${r[0]!.value}/${r[1]!.value}`))).toBe(true);
    // A plain enum value is written as v2.state.open; one that needs quotes as a string.
    const states = column(merchants, 'state');
    expect(states.every((v) => (v.kind === 'enum' && v.value === 'v2.state.open') || (v.kind === 'string' && v.value === 'on hold'))).toBe(true);
  });

  it('notes a table it doesn’t know', () => {
    expect(generateRows(shop, [T('nowhere')], { rows: 5, seed: 1 })).toEqual({ tables: [], added: [], notes: ['There is no table public.nowhere in the schema.'] });
  });
});
