import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diffLines, diffSchemas } from './diff';
import { parseDbml } from './parse';

const read = (text: string) => {
  const { schema, errors } = parseDbml(text);
  expect(errors).toEqual([]);
  return schema;
};
const texts = (a: string, b: string) => diffSchemas(read(a), read(b)).changes.map((c) => c.text);
const SHOP = readFileSync('tests/fixtures/dbml/shop.dbml', 'utf8');

describe('the changes between two versions of a schema', () => {
  it('lists exactly the column and the ref added to a saved version', () => {
    const newer = SHOP.replace('  created_at timestamp [default: `now()`]\n', '  created_at timestamp [default: `now()`]\n  referrer_id integer\n') + '\nRef: customers.referrer_id > customers.id\n';
    const diff = diffSchemas(read(SHOP), read(newer));
    expect(diff.changes.map((c) => [c.kind, c.text])).toEqual([
      ['column-added', 'Added column referrer_id (integer)'],
      ['ref-added', 'Added ref referrer_id > customers.id'],
    ]);
    expect(diff.tables).toMatchObject([{ name: 'customers', status: 'changed' }]);
  });

  it('finds nothing between a schema and itself, or the same ref written inline and on its own', () => {
    expect(texts(SHOP, SHOP)).toEqual([]);
    expect(texts('Table a {\n  id int [pk]\n}\nTable b {\n  a_id int [ref: > a.id]\n}', 'Table a {\n  id int [pk]\n}\nTable b {\n  a_id int\n}\nRef: a.id < b.a_id')).toEqual([]);
  });

  it('tells added and removed tables and columns', () => {
    expect(texts('Table a {\n  id int\n  age int\n}\nTable gone {\n  x int\n}', 'Table a {\n  id int\n  email varchar\n}\nTable b {\n  y text\n}')).toEqual([
      'Removed column age',
      'Added column email (varchar)',
      'Added table b',
      'Removed table gone',
    ]);
    expect(diffSchemas(read('Table gone {\n  x int\n}'), read('')).tables).toMatchObject([{ name: 'gone', status: 'removed', older: { name: 'gone' } }]);
  });

  it('describes changes to a column’s type, nullability, default, increment, unique, checks and note', () => {
    const was = 'Table t {\n  id int\n  total int\n  email varchar\n  code varchar [not null, default: \'a\', unique, check: `code <> \'\'`]\n}';
    const now = "Table t {\n  id int [increment]\n  total decimal(10,2)\n  email varchar [not null, note: 'Where we write']\n  code varchar [default: 'b']\n}";
    expect(texts(was, now)).toEqual([
      'Made id increment',
      'Changed the type of total from int to decimal(10,2)',
      'Made email not null',
      'Added the note on email',
      'Made code nullable',
      "Changed the default of code from 'a' to 'b'",
      'Removed unique on code',
      "Removed check `code <> ''` on code",
    ]);
    expect(texts('Table t {\n  a int [default: 1]\n}', 'Table t {\n  a int\n}')).toEqual(['Removed the default of a']);
    expect(texts('Table t {\n  a int\n}', 'Table t {\n  a int [default: `now()`]\n}')).toEqual(['Set the default of a to `now()`']);
  });

  it('describes keys, indexes, table checks, notes and records', () => {
    const was = "Table t {\n  id int\n  a int\n  b int\n  indexes {\n    a [unique]\n  }\n  checks {\n    `a > 0`\n  }\n}";
    const now = "Table t {\n  id int [pk]\n  a int\n  b int\n  indexes {\n    (a, b)\n    b [name: 'by_b']\n  }\n  checks {\n    `b > 0`\n  }\n  Note: 'Things'\n  records (id) {\n    1\n  }\n}";
    expect(texts(was, now)).toEqual([
      'Added the note on t',
      'Added primary key on id',
      'Removed unique index on a',
      'Added index on (a, b)',
      'Added index by_b on b',
      'Removed check `a > 0`',
      'Added check `b > 0`',
      'Changed the records of t',
    ]);
    expect(texts('Table t {\n  a int\n  b int\n  indexes {\n    (a, b) [pk]\n  }\n}', 'Table t {\n  a int [pk]\n  b int\n}')).toEqual(['Changed the primary key from (a, b) to a']);
  });

  it('describes refs added, removed and changed, under the table they start from', () => {
    const tables = 'Table a {\n  id int [pk]\n}\nTable b {\n  id int\n  a_id int\n}\n';
    const diff = diffSchemas(read(`${tables}Ref: b.a_id > a.id`), read(`${tables}Ref: b.a_id > a.id [delete: cascade]\nRef: b.id - a.id`));
    expect(diff.changes.map((c) => c.text)).toEqual(['Changed ref a_id > a.id: on delete cascade', 'Added ref id - a.id']);
    expect(diff.tables.map((t) => t.name)).toEqual(['b']);
    expect(texts(`${tables}Ref: b.a_id > a.id`, tables)).toEqual(['Removed ref a_id > a.id']);
    expect(texts(`${tables}Ref: b.a_id > a.id`, `${tables}Ref: b.a_id - a.id`)).toEqual(['Changed ref a_id - a.id: was >']);
  });

  it('describes enums added, removed and their values', () => {
    expect(texts('Enum s {\n  a\n  b\n}\nEnum old {\n  x\n}', "Enum s {\n  a\n  refunded\n}\nEnum v2.n {\n  y\n}")).toEqual([
      "Added value 'refunded' to enum s",
      "Removed value 'b' from enum s",
      'Added enum v2.n',
      'Removed enum old',
    ]);
  });

  it('describes groups, sticky notes and the project note', () => {
    const was = "Project p {\n  Note: 'one'\n}\nTable a {\n  id int\n}\nTableGroup g {\n  a\n}\nTableGroup h {\n  a\n}\nNote n {\n  'x'\n}";
    const now = "Project p {\n  Note: 'two'\n}\nTable a {\n  id int\n}\nTableGroup g [color: #fff] {\n  a\n}\nTableGroup k {\n  a\n}\nNote n {\n  'y'\n}\nNote m {\n  'z'\n}";
    expect(texts(was, now)).toEqual(['Changed group g', 'Added group k', 'Removed group h', 'Changed sticky note n', 'Added sticky note m', 'Changed the project note']);
  });
});

describe('renames', () => {
  it('tells a renamed table by its columns, and keeps its refs and groups the same', () => {
    const was = 'Table customers {\n  id int [pk]\n  name varchar\n}\nTable orders {\n  id int\n  customer_id int [ref: > customers.id]\n}\nTableGroup g {\n  customers\n}';
    const now = 'Table clients {\n  id int [pk]\n  name varchar\n}\nTable orders {\n  id int\n  customer_id int [ref: > clients.id]\n}\nTableGroup g {\n  clients\n}';
    const diff = diffSchemas(read(was), read(now));
    expect(diff.changes.map((c) => c.text)).toEqual(['Renamed table customers to clients']);
    expect(diff.tables).toMatchObject([{ name: 'clients', status: 'renamed', older: { name: 'customers' }, newer: { name: 'clients' } }]);
  });

  it('tells a renamed column when one column went and one came with the same type and settings', () => {
    const was = 'Table a {\n  id int [pk]\n}\nTable b {\n  id int\n  owner int [not null, ref: > a.id]\n}';
    const now = 'Table a {\n  id int [pk]\n}\nTable b {\n  id int\n  a_id int [not null, ref: > a.id]\n}';
    expect(texts(was, now)).toEqual(['Renamed column owner to a_id']);
  });

  it('doesn’t guess a rename when the settings differ or more than one could match', () => {
    expect(texts('Table t {\n  a int\n}', 'Table t {\n  b int [not null]\n}')).toEqual(['Removed column a', 'Added column b (int)']);
    expect(texts('Table t {\n  a int\n  b int\n}', 'Table t {\n  c int\n  d int\n}')).toEqual(['Removed column a', 'Removed column b', 'Added column c (int)', 'Added column d (int)']);
    expect(texts('Table a {\n  id int\n}\nTable b {\n  id int\n}', 'Table c {\n  id int\n}\nTable d {\n  id int\n}')).toEqual(['Added table c', 'Added table d', 'Removed table a', 'Removed table b']);
    expect(texts('Table a {\n  id int\n}', 'Table v2.b {\n  id int\n}')).toEqual(['Added table v2.b', 'Removed table a']);
  });
});

describe('the line diff of two texts', () => {
  it('keeps the common lines and marks the rest added or removed, with each side’s line numbers', () => {
    expect(diffLines('a\nb\nc\nd', 'a\nc\nx\nd')).toEqual([
      { op: 'same', text: 'a', a: 1, b: 1 },
      { op: 'removed', text: 'b', a: 2 },
      { op: 'same', text: 'c', a: 3, b: 2 },
      { op: 'added', text: 'x', b: 3 },
      { op: 'same', text: 'd', a: 4, b: 4 },
    ]);
    expect(diffLines('', 'a')).toEqual([
      { op: 'removed', text: '', a: 1 },
      { op: 'added', text: 'a', b: 1 },
    ]);
    expect(diffLines('same', 'same')).toEqual([{ op: 'same', text: 'same', a: 1, b: 1 }]);
  });

  it('still answers for texts too long to match line by line', () => {
    const a = Array.from({ length: 4500 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 4500 }, (_, i) => `b${i}`).join('\n');
    const ops = diffLines(`top\n${a}\nend`, `top\n${b}\nend`);
    expect(ops).toHaveLength(9002);
    expect(ops[0]).toEqual({ op: 'same', text: 'top', a: 1, b: 1 });
    expect(ops.at(-1)).toEqual({ op: 'same', text: 'end', a: 4502, b: 4502 });
    expect(ops.filter((o) => o.op === 'removed')).toHaveLength(4500);
  });
});
