import { describe, expect, it } from 'vitest';
import { addColumn, defaultText, parseDefault, parseNewColumn, addRef, addStickyNote, addTable, createGroup, deleteColumn, deleteTable, freeName, moveToGroup, renameColumn, renameTable, setTableColor, setTableNote, updateColumn } from './edit';
import { parseDbml } from './parse';

const SHOP = `// The shop
Table users {
  id integer [pk] // who
  email varchar [unique]
}

Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
  total decimal(10,2)

  indexes {
    (user_id, total)
  }
}

records users(id, email) {
  1, 'a@b.c'
}

TableGroup people {
  users
}

Ref: orders.user_id > users.id [delete: cascade]
`;

const u = { schema: 'public', table: 'users' };
const o = { schema: 'public', table: 'orders' };
const ok = (text: string) => expect(parseDbml(text).errors).toEqual([]);

describe('adding a ref', () => {
  it('adds one line after the refs at the end, and nothing else changes', () => {
    const out = addRef(SHOP, { from: { ...o, column: 'total' }, to: { ...u, column: 'email' }, op: '-', toOptional: true });
    expect(out).toBe(`${SHOP}Ref: orders.total -? users.email\n`);
    ok(out);
  });

  it('starts after a blank line when the text ends with something else, and quotes names that need it', () => {
    const text = 'Table "a b" {\n  id int\n}\nTable c {\n  id int\n}';
    expect(addRef(text, { from: { schema: 'public', table: 'a b', column: 'id' }, to: { schema: 'public', table: 'c', column: 'id' }, op: '<' })).toBe(`${text}\n\nRef: "a b".id < c.id\n`);
    expect(addRef('', { from: { ...o, column: 'id' }, to: { ...u, column: 'id' }, op: '<>' })).toBe('Ref: orders.id <> users.id\n');
  });
});

describe('renaming', () => {
  it('renames a table in its header, every ref, the records and its group, and nowhere else', () => {
    const out = renameTable(SHOP, u, 'people');
    expect(out).toBe(
      SHOP.replace('Table users {', 'Table people {')
        .replace('[ref: > users.id]', '[ref: > people.id]')
        .replace('records users(', 'records people(')
        .replace('TableGroup people {\n  users', 'TableGroup people {\n  people')
        .replace('Ref: orders.user_id > users.id', 'Ref: orders.user_id > people.id'),
    );
    ok(out);
  });

  it('renames a table in another schema only where that schema names it', () => {
    const text = 'Table v2.users {\n  id int\n}\nTable users {\n  id int\n}\nRef: v2.users.id > users.id';
    expect(renameTable(text, { schema: 'v2', table: 'users' }, 'members')).toBe('Table v2.members {\n  id int\n}\nTable users {\n  id int\n}\nRef: v2.members.id > users.id');
  });

  it('refuses a name another table has', () => {
    expect(() => renameTable(SHOP, u, 'orders')).toThrow('already a table called orders');
  });

  it('renames a column in its line, refs, indexes and records, and not a same-named column elsewhere', () => {
    const out = renameColumn(SHOP, { ...o, column: 'user_id' }, 'buyer_id');
    expect(out).toBe(SHOP.replace('  user_id integer', '  buyer_id integer').replace('(user_id, total)', '(buyer_id, total)').replace('orders.user_id >', 'orders.buyer_id >'));
    const id = renameColumn(SHOP, { ...u, column: 'id' }, 'user_key');
    expect(id).toBe(SHOP.replace('  id integer [pk] // who', '  user_key integer [pk] // who').replace('users.id]', 'users.user_key]').replace('records users(id,', 'records users(user_key,').replace('> users.id [', '> users.user_key ['));
    ok(id);
  });
});

describe('columns', () => {
  it('rewrites one column’s settings and keeps its inline ref and the comment after it', () => {
    expect(updateColumn(SHOP, { ...o, column: 'user_id' }, { notNull: true })).toBe(SHOP.replace('user_id integer [ref: > users.id]', 'user_id integer [not null, ref: > users.id]'));
    expect(updateColumn(SHOP, { ...u, column: 'id' }, { pk: false, type: 'bigint' })).toBe(SHOP.replace('id integer [pk] // who', 'id bigint // who'));
    expect(updateColumn(SHOP, { ...u, column: 'email' }, { default: { kind: 'string', value: 'none' } })).toBe(SHOP.replace("email varchar [unique]", "email varchar [unique, default: 'none']"));
  });

  it('adds a column after another, or at the end', () => {
    expect(addColumn(SHOP, u, { name: 'name', type: 'text' }, 'id')).toBe(SHOP.replace('  id integer [pk] // who\n', '  id integer [pk] // who\n  name text\n'));
    expect(addColumn(SHOP, u, { name: 'name', type: 'text', notNull: true })).toBe(SHOP.replace('email varchar [unique]\n', 'email varchar [unique]\n  name text [not null]\n'));
    expect(addColumn('Table t {\n}', { schema: 'public', table: 't' }, { name: 'id', type: 'int' })).toBe('Table t {\n  id int\n}');
  });

  it('deletes a column with the refs and indexes that use it', () => {
    const out = deleteColumn(SHOP, { ...o, column: 'user_id' });
    expect(out).toBe(SHOP.replace('  user_id integer [ref: > users.id]\n', '').replace('    (user_id, total)\n', '').replace('Ref: orders.user_id > users.id [delete: cascade]\n', ''));
    // The users.id it pointed at loses only the refs: users' own line stays.
    const id = deleteColumn(SHOP, { ...u, column: 'id' });
    expect(id).toContain('user_id integer\n');
    expect(id).not.toContain('Ref:');
    expect(parseDbml(id).schema.refs).toEqual([]);
  });
});

describe('tables', () => {
  it('adds a table at the end', () => {
    expect(addTable('', { schema: 'public', table: 'items' })).toBe('Table items {\n  id integer [pk]\n}\n');
    expect(addTable(SHOP, { schema: 'v2', table: 'items' })).toBe(`${SHOP}\nTable v2.items {\n  id integer [pk]\n}\n`);
  });

  it('deletes a table with every ref to it, its records and its group line', () => {
    const out = deleteTable(SHOP, u);
    ok(out);
    const s = parseDbml(out).schema;
    expect(s.tables.map((t) => t.name)).toEqual(['orders']);
    expect(s.refs).toEqual([]);
    expect(s.records).toEqual([]);
    expect(s.groups[0]!.tables).toEqual([]);
    expect(out.startsWith('// The shop\nTable orders {\n  id integer [pk]\n  user_id integer\n')).toBe(true);
  });

  it('sets, replaces and clears the header colour, keeping other settings', () => {
    const coloured = setTableColor(SHOP, u, '#3498DB');
    expect(coloured).toBe(SHOP.replace('Table users {', 'Table users [headercolor: #3498DB] {'));
    expect(setTableColor(coloured, u, '#E74C3C')).toBe(SHOP.replace('Table users {', 'Table users [headercolor: #E74C3C] {'));
    expect(setTableColor(coloured, u, undefined)).toBe(SHOP);
    const other = 'Table t [owner: "me", headercolor: #fff] {\n  id int\n}';
    expect(setTableColor(other, { schema: 'public', table: 't' }, undefined)).toBe('Table t [owner: "me"] {\n  id int\n}');
  });

  it('sets, replaces and clears a table note', () => {
    const noted = setTableNote(SHOP, u, 'People who buy');
    expect(noted).toBe(SHOP.replace("  email varchar [unique]\n}", "  email varchar [unique]\n\n  Note: 'People who buy'\n}"));
    expect(setTableNote(noted, u, 'Buyers')).toBe(SHOP.replace("  email varchar [unique]\n}", "  email varchar [unique]\n\n  Note: 'Buyers'\n}"));
    expect(setTableNote(noted, u, undefined)).toBe(SHOP.replace("  email varchar [unique]\n}", "  email varchar [unique]\n\n}"));
  });
});

describe('groups and notes', () => {
  it('moves a table between groups, out of every group, and into a new one', () => {
    const into = moveToGroup(SHOP, o, 'people');
    expect(into).toBe(SHOP.replace('TableGroup people {\n  users\n}', 'TableGroup people {\n  users\n  orders\n}'));
    expect(moveToGroup(into, u, undefined)).toBe(SHOP.replace('TableGroup people {\n  users\n}', 'TableGroup people {\n  orders\n}'));
    const fresh = moveToGroup(SHOP, u, 'customers');
    expect(parseDbml(fresh).schema.groups.map((g) => [g.name, g.tables.map((t) => t.name)])).toEqual([
      ['people', []],
      ['customers', ['users']],
    ]);
  });

  it('creates a group from tables, taking them out of their groups', () => {
    const out = createGroup(SHOP, 'shop', [u, o]);
    expect(out).toBe(`${SHOP.replace('TableGroup people {\n  users\n}', 'TableGroup people {\n}')}\nTableGroup shop {\n  users\n  orders\n}\n`);
  });

  it('adds a sticky note, and finds a free name', () => {
    expect(addStickyNote('', 'note_1', 'Remember')).toBe("Note note_1 {\n  'Remember'\n}\n");
    expect(freeName('note', ['note', 'note_2'])).toBe('note_3');
  });
});

describe('what is typed into the diagram', () => {
  it('reads a default as DBML would write it', () => {
    expect(['42', '-1.5', 'TRUE', 'null', '`now()`', "'x y'", 'pending', ''].map(parseDefault)).toEqual([
      { kind: 'number', value: '42' },
      { kind: 'number', value: '-1.5' },
      { kind: 'boolean', value: 'true' },
      { kind: 'null', value: 'null' },
      { kind: 'expression', value: 'now()' },
      { kind: 'string', value: 'x y' },
      { kind: 'string', value: 'pending' },
      undefined,
    ]);
    expect(defaultText({ kind: 'expression', value: 'now()' })).toBe('`now()`');
  });

  it('reads a new column’s name and type', () => {
    expect(parseNewColumn('email varchar(255)')).toEqual({ name: 'email', type: 'varchar(255)' });
    expect(parseNewColumn('"full name"')).toEqual({ name: 'full name', type: 'varchar' });
    expect(parseNewColumn('  ')).toBeUndefined();
  });
});
