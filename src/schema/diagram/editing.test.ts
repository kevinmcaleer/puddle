import { describe, expect, it, vi } from 'vitest';
import { parseDbml } from '../parse';
import { answer, columnMenu, suggestOp, tableMenu, type Ask } from './editing';

const DBML = 'Table users {\n  id int [pk]\n  email text\n}\nTable orders {\n  id int [pk]\n  user_id int\n}\nTableGroup people {\n  users\n}';
const schema = parseDbml(DBML).schema;
const users = { schema: 'public', table: 'users' };
const ask = (kind: Ask['kind'], value: string, extra: Partial<Ask> = {}): Ask => ({ kind, table: users, value, at: { left: 0, top: 0 }, ...extra });

describe('what a typed answer does', () => {
  it('renames a table, and says where its place goes', () => {
    const made = answer(ask('rename-table', 'users'), ' people_list ')!;
    expect(made.renamed).toEqual({ from: 'table:public.users', to: 'table:public.people_list' });
    expect(made.change(DBML)).toContain('Table people_list {');
  });

  it('changes nothing for an unchanged or empty answer', () => {
    expect(answer(ask('rename-table', 'users'), 'users')).toBeUndefined();
    expect(answer(ask('rename-column', 'email', { column: 'email' }), '')).toBeUndefined();
    expect(answer(ask('default', '', { column: 'email' }), '  ')).toBeUndefined();
    expect(answer(ask('new-column', ''), ' ')).toBeUndefined();
  });

  it('sets a type, a default, a note, a new column and a new group', () => {
    const run = (a: Ask, v: string) => answer(a, v)!.change(DBML);
    expect(run(ask('type', 'text', { column: 'email' }), 'varchar(320)')).toContain('email varchar(320)');
    expect(run(ask('default', '', { column: 'email' }), "'none'")).toContain("email text [default: 'none']");
    expect(run(ask('note', ''), 'Who buys')).toContain("Note: 'Who buys'");
    expect(run(ask('new-column', '', { column: 'id' }), 'name text')).toContain('id int [pk]\n  name text\n  email text');
    expect(parseDbml(run(ask('new-group', '', { tables: [users, { schema: 'public', table: 'orders' }] }), 'shop')).schema.groups.map((g) => [g.name, g.tables.length])).toEqual([
      ['people', 0],
      ['shop', 2],
    ]);
  });
});

describe('a dragged ref', () => {
  it('points many to one at a key, one to many from one, one to one between keys', () => {
    expect(suggestOp(schema, { schema: 'public', table: 'orders', column: 'user_id' }, { ...users, column: 'id' })).toBe('>');
    expect(suggestOp(schema, { ...users, column: 'id' }, { schema: 'public', table: 'orders', column: 'user_id' })).toBe('<');
    expect(suggestOp(schema, { ...users, column: 'id' }, { schema: 'public', table: 'orders', column: 'id' })).toBe('-');
  });
});

describe('the menus', () => {
  const t = schema.tables[0]!;
  it('offer a table’s actions, with its group ticked and the selection for a new group', () => {
    const edit = vi.fn();
    const asked = vi.fn();
    const items = tableMenu(schema, t, edit, asked, [{ schema: 'public', table: 'orders' }]);
    expect(items.map((i) => i.label)).toEqual(['Rename…', 'Add column…', 'Add note…', 'Header colour', 'Group', 'Delete table']);
    const group = items.find((i) => i.label === 'Group')!.items!;
    expect(group.map((i) => [i.label, !!i.checked])).toEqual([
      ['people', true],
      ['Out of people', false],
      ['New group with 2 tables…', false],
    ]);
    group[2]!.onSelect();
    expect(asked).toHaveBeenCalledWith('new-group', '', { tables: [users, { schema: 'public', table: 'orders' }] });
    items.find((i) => i.label === 'Header colour')!.items![1]!.onSelect();
    expect((edit.mock.calls[0]![0] as (d: string) => string)(DBML)).toContain('Table users [headercolor: #3498DB] {');
  });

  it('offer a column’s settings as toggles, ticked as they are', () => {
    const edit = vi.fn();
    const items = columnMenu(t, 'id', edit, vi.fn());
    expect(items.filter((i) => i.toggle).map((i) => [i.label, i.checked])).toEqual([
      ['Primary key', true],
      ['Unique', false],
      ['Not null', false],
      ['Increment', false],
    ]);
    items.find((i) => i.label === 'Primary key')!.onSelect();
    expect((edit.mock.calls[0]![0] as (d: string) => string)(DBML)).toContain('  id int\n');
  });
});
