import { readFileSync, readdirSync } from 'node:fs';
import { DbmlSchemaZ, enumOf, findTable, parseDbml, withoutRanges, type DbmlSchema } from '.';

const dir = 'tests/fixtures/dbml/';
const fixture = (name: string) => readFileSync(`${dir}${name}`, 'utf8');
const parsed = (name: string) => {
  const { schema, errors } = parseDbml(fixture(name));
  expect(errors).toEqual([]);
  return schema;
};
const table = (s: DbmlSchema, name: string, schemaName = 'public') => findTable(s, { schema: schemaName, name })!;
const col = (s: DbmlSchema, t: string, c: string) => table(s, t).columns.find((x) => x.name === c)!;

describe('parseDbml on the DBML docs examples', () => {
  it.each(readdirSync(dir).filter((f) => f.endsWith('.dbml')))('%s parses without errors and validates', (name) => {
    const { schema, errors } = parseDbml(fixture(name));
    expect(errors).toEqual([]);
    expect(DbmlSchemaZ.parse(JSON.parse(JSON.stringify(schema)))).toEqual(withoutUndefined(schema));
  });

  it('reads the project', () => {
    expect(parsed('project.dbml').project).toEqual({ name: 'project_name', databaseType: 'PostgreSQL', note: 'Description of the project', properties: {} });
    const note = parsed('project-note.dbml').project!.note!;
    expect(note.split('\n')[0]).toBe('# DBML - Database Markup Language');
    expect(note).toContain('\n\n## Benefits\n\n* It is simple');
  });

  it('puts tables in the public schema unless one is named', () => {
    const s = parsed('schemas.dbml');
    expect(s.tables.map((t) => [t.schema, t.name])).toEqual([
      ['public', 'table_name'],
      ['core', 'user'],
      ['core', 'users'],
      ['blogging', 'posts'],
    ]);
    expect(s.refs.map((r) => [r.from, r.to, r.inline])).toEqual([
      [{ schema: 'blogging', table: 'posts', columns: ['user_id'] }, { schema: 'core', table: 'users', columns: ['id'] }, true],
      [{ schema: 'blogging', table: 'posts', columns: ['user_id'] }, { schema: 'core', table: 'users', columns: ['id'] }, false],
    ]);
  });

  it('resolves a table alias in refs', () => {
    const s = parsed('alias.dbml');
    expect(table(s, 'very_long_user_table').alias).toBe('U');
    expect(s.refs[0]).toMatchObject({ from: { table: 'very_long_user_table', columns: ['id'] }, op: '<', to: { table: 'posts', columns: ['user_id'] } });
  });

  it('reads column types and settings', () => {
    const s = parsed('columns.dbml');
    expect(withoutRanges(col(s, 'buildings', 'address'))).toEqual({ name: 'address', type: 'varchar(255)', pk: false, unique: true, notNull: true, increment: false, checks: [], note: 'to include unit number', properties: {} });
    expect(col(s, 'buildings', 'id')).toMatchObject({ pk: true, unique: true, default: { kind: 'number', value: '123' }, note: 'Number' });
    expect(col(s, 'buildings', 'price')).toMatchObject({ type: 'double precision', notNull: false });
    expect(col(s, 'buildings', 'big').type).toBe('bigint unsigned');
    expect(col(s, 'buildings', 'ratio')).toMatchObject({ type: 'decimal(10, 2)', default: { kind: 'number', value: '-1.5' } });
    expect(col(s, 'buildings', 'tags').type).toBe('text[]');
    expect(col(s, 'users', 'id').pk).toBe(true);
    expect(col(s, 'users', 'source').default).toEqual({ kind: 'string', value: 'direct' });
    expect(col(s, 'users', 'created_at').default).toEqual({ kind: 'expression', value: 'now()' });
    expect(col(s, 'users', 'removed_at').default).toEqual({ kind: 'expression', value: "now() - interval '5 days'" });
    expect(col(s, 'users', 'active').default).toEqual({ kind: 'boolean', value: 'false' });
    expect(col(s, 'users', 'nickname').default).toEqual({ kind: 'null', value: 'null' });
    expect(col(s, 'users', 'serial').increment).toBe(true);
    expect(col(s, 'users', 'age').checks).toEqual(['age >= 0', 'age < 150']);
    expect(col(s, 'users', 'first name').type).toBe('varchar');
    expect(col(s, 'users', 'gender').notNull).toBe(true);
    expect(col(s, 'users', 'rating').notNull).toBeUndefined();
  });

  it('reads table checks', () => {
    expect(table(parsed('checks.dbml'), 'users').checks.map(withoutRanges)).toEqual([{ expression: 'debt + wealth >= 0', name: 'chk_positive_money' }, { expression: 'id > 0' }]);
  });

  it('reads indexes: single, composite, expressions and settings', () => {
    const ix = table(parsed('indexes.dbml'), 'bookings').indexes.map(withoutRanges);
    const c = (value: string) => ({ kind: 'column', value });
    const e = (value: string) => ({ kind: 'expression', value });
    expect(ix).toEqual([
      { parts: [c('id'), c('country')], pk: true, unique: false },
      { parts: [c('created_at')], name: 'created_at_index', note: 'Date', pk: false, unique: false },
      { parts: [c('booking_date')], pk: false, unique: false },
      { parts: [c('country'), c('booking_date')], unique: true, pk: false },
      { parts: [c('booking_date')], type: 'hash', pk: false, unique: false },
      { parts: [e('id*2')], pk: false, unique: false },
      { parts: [e('id*3'), e('getdate()')], pk: false, unique: false },
      { parts: [e('id*3'), c('id')], pk: false, unique: false },
    ]);
  });

  it('reads refs in every form, with optional sides, composites and settings', () => {
    const refs = parsed('refs.dbml').refs.map(withoutRanges);
    const end = (table: string, ...columns: string[]) => ({ schema: 'public', table, columns });
    const base = { fromOptional: false, toOptional: false, inactive: false, inline: false };
    expect(refs).toEqual([
      { ...base, from: end('users', 'id'), op: '<', to: end('posts', 'user_id'), inline: true },
      { ...base, from: end('users', 'id'), op: '<', to: end('reviews', 'user_id'), inline: true },
      { ...base, from: end('posts', 'user_id'), op: '>', to: end('users', 'id'), inline: true },
      { ...base, from: end('posts', 'editor_id'), op: '>', to: end('users', 'id'), inline: true, toOptional: true },
      { ...base, from: end('user_infos', 'user_id'), op: '-', to: end('users', 'id'), inline: true },
      { ...base, name: 'name_optional', from: end('posts', 'user_id'), op: '>', to: end('users', 'id'), fromOptional: true },
      { ...base, name: 'posts_users', from: end('posts', 'user_id'), op: '>', to: end('users', 'id') },
      { ...base, from: end('authors', 'id'), op: '<>', to: end('books', 'id') },
      { ...base, from: end('merchant_periods', 'merchant_id', 'country_code'), op: '>', to: end('merchants', 'id', 'country_code') },
      { ...base, from: end('products', 'merchant_id'), op: '>', to: end('merchants', 'id'), delete: 'cascade', update: 'no action' },
      { ...base, from: end('products', 'merchant_id'), op: '>', to: end('merchants', 'id'), delete: 'set null', update: 'set default', color: '#79AD51' },
      { ...base, from: end('posts', 'user_id'), op: '>', to: end('users', 'id'), inactive: true },
      { ...base, from: end('posts', 'user_id'), op: '>', to: end('users', 'id'), delete: 'restrict', inactive: true },
      { ...base, from: end('users', 'id'), op: '-', to: end('user_infos', 'user_id') },
    ]);
  });

  it('reads enums, in a schema or not, with quoted values, and finds a column’s enum', () => {
    const s = parsed('enums.dbml');
    expect(s.enums.map((e) => [e.schema, e.name, e.values.map((v) => v.name)])).toEqual([
      ['public', 'job_status', ['created', 'running', 'done', 'failure']],
      ['v2', 'job_status', ['queued', 'finished']],
      ['public', 'grade', ['A+', 'A', 'A-', 'Not Yet Set']],
    ]);
    expect(s.enums[0]!.values[0]!.note).toBe('Waiting to be processed');
    expect(enumOf(s, col(s, 'jobs', 'status'))!.schema).toBe('public');
    expect(enumOf(s, col(s, 'jobs', 'status_v2'))!.schema).toBe('v2');
    expect(enumOf(s, col(s, 'jobs', 'id'))).toBeUndefined();
  });

  it('injects partials as the docs’ final result shows', () => {
    const users = table(parsed('partials.dbml'), 'users');
    const expected = table(parsed('partials-resolved.dbml'), 'users');
    const strip = (x: object) => withoutRanges({ ...x, partial: undefined });
    expect(users.columns.map(strip)).toEqual(expected.columns.map(strip));
    expect(users.indexes.map(strip)).toEqual(expected.indexes.map(strip));
    expect(users.headerColor).toBe('#ff0000');
    expect(users.columns.map((c) => c.partial)).toEqual(['base_template', 'base_template', 'base_template', 'email_index', undefined, 'soft_delete_template', 'soft_delete_template']);
    expect(users.partials).toEqual([
      { name: 'base_template', at: 0 },
      { name: 'email_index', at: 0 },
      { name: 'soft_delete_template', at: 1 },
    ]);
  });

  it('lets a table’s own column and settings win over a partial’s, keeping the partial’s place', () => {
    const accounts = table(parsed('partials.dbml'), 'accounts');
    expect(accounts.columns.map((c) => [c.name, c.type, c.partial])).toEqual([
      ['id', 'bigint', undefined],
      ['created_at', 'timestamp', 'base_template'],
      ['updated_at', 'timestamp', 'base_template'],
    ]);
    expect(accounts.columns[0]).toMatchObject({ pk: true, increment: true });
    expect(accounts.headerColor).toBe('#00ff00');
  });

  it('reads records inside and outside tables, with every kind of value', () => {
    const s = parsed('records.dbml');
    const recs = Object.fromEntries(s.records.map((r) => [r.table, withoutRanges(r)]));
    expect(recs.users).toMatchObject({ columns: ['id', 'name', 'email'], implicit: false, inline: false, example: false });
    expect(recs.posts).toMatchObject({ columns: ['id', 'title', 'published'], implicit: false, inline: true });
    expect(recs.posts!.rows[0]).toEqual([
      { kind: 'number', value: '1' },
      { kind: 'string', value: 'First Post' },
      { kind: 'boolean', value: 'true' },
    ]);
    expect(recs.comments).toMatchObject({ columns: ['id', 'user_id', 'post_id', 'title'], implicit: true, inline: true });
    expect(recs.members!.rows).toEqual([
      [
        { kind: 'number', value: '1' },
        { kind: 'string', value: 'Alice' },
        { kind: 'number', value: '30' },
        { kind: 'enum', value: 'Status.active' },
        { kind: 'string', value: '2024-01-15 10:30:00' },
      ],
      [
        { kind: 'number', value: '2' },
        { kind: 'string', value: 'Bob' },
        { kind: 'null', value: 'null' },
        { kind: 'string', value: 'inactive' },
        { kind: 'expression', value: 'now()' },
      ],
      [
        { kind: 'number', value: '3' },
        { kind: 'string', value: 'Charlie' },
        { kind: 'empty', value: '' },
        { kind: 'enum', value: 'Status.pending' },
        { kind: 'string', value: '2024-01-15' },
      ],
      [
        { kind: 'number', value: '4' },
        { kind: 'string', value: "Dan's" },
        { kind: 'number', value: '-2.5e3' },
        { kind: 'string', value: 'active' },
        { kind: 'string', value: '' },
      ],
    ]);
    expect(recs.examples).toMatchObject({ example: true, implicit: true, inline: true });
    expect(recs.examples2).toMatchObject({ example: true, implicit: false, inline: false });
    expect(s.records.map((r) => r.table)).toEqual(['users', 'posts', 'comments', 'members', 'examples', 'examples2']);
  });

  it('reads notes in every form, multi-line strings and comments', () => {
    const s = parsed('notes.dbml');
    expect(table(s, 'users').note).toBe('This is a note of this table');
    expect(table(s, 'accounts').note).toBe('This is a note of this table');
    expect(col(s, 'orders', 'status').note).toBe('💸 1 = processing,\n✔️ 2 = shipped,\n❌ 3 = cancelled,\n😔 4 = refunded');
    expect(s.groups.map((g) => g.note)).toEqual(['Contains tables that are related to e-commerce system', 'Contains tables that are related to e-commerce system']);
    expect(s.notes.map((n) => [n.name, n.text, n.color])).toEqual([
      ['single_line_note', 'This is a single line note', undefined],
      ['multiple_lines_note', 'This is a multiple lines note\nThis string can spans over multiple lines.', undefined],
      ['reminder', 'This is a reminder', '#F4D03F'],
      ['no_color', 'This note has no background color', 'none'],
      ['continued', "One line continued, with a \\ and a ' in it", undefined],
    ]);
  });

  it('reads table groups, case-insensitively, with schemas and settings', () => {
    const s = parsed('groups.dbml');
    expect(s.groups.map(withoutRanges)).toEqual([
      { name: 'tablegroup_name', tables: [{ schema: 'public', name: 'merchants' }, { schema: 'public', name: 'countries' }, { schema: 'core', name: 'table3' }], properties: {} },
      { name: 'e_commerce1', tables: [{ schema: 'public', name: 'merchants' }, { schema: 'public', name: 'countries' }], color: '#3498DB', properties: { team: 'growth' } },
    ]);
  });

  it('reads custom properties, with Metadata blocks winning over inline ones', () => {
    const s = parsed('properties.dbml');
    expect(table(s, 'users').properties).toEqual({ owner: 'scott', sla_hours: '24', pii: 'true', brand_color: '#3498DB' });
    expect(table(s, 'users').note).toBe('scott is the owner');
    expect(col(s, 'users', 'id').properties).toEqual({ masking: 'full', pii: 'true' });
    expect(col(s, 'users', 'email').properties).toEqual({ classification: 'confidential' });
    expect(s.groups[0]!.properties).toEqual({ team: 'platform' });
    expect(s.notes[0]!.properties).toEqual({ author: 'docs' });
  });

  it('reads diagram views', () => {
    expect(parsed('views.dbml').views.map(withoutRanges)).toEqual([
      { name: 'full_view', tables: '*', notes: '*', groups: '*', schemas: '*' },
      { name: 'empty_view' },
      { name: 'sales_view', tables: ['users', 'orders', 'products'] },
      { name: 'mixed_view', tables: '*', notes: ['reminder_note'], groups: ['group_2'], schemas: ['core'] },
    ]);
  });

  it('keeps where each element is, for editing in place', () => {
    const text = fixture('shop.dbml');
    const s = parsed('shop.dbml');
    const orders = table(s, 'orders');
    expect(text.slice(orders.range!.start, orders.range!.end)).toMatch(/^Table orders \{[\s\S]*\}$/);
    expect(text.slice(orders.nameRange!.start, orders.nameRange!.end)).toBe('orders');
    const total = col(s, 'orders', 'total');
    expect(text.slice(total.range!.start, total.range!.end)).toBe('total decimal(10,2) [not null, check: `total >= 0`]');
    const ref = s.refs.find((r) => !r.inline)!;
    expect(text.slice(ref.range!.start, ref.range!.end)).toBe('Ref: order_items.order_id > orders.id [delete: cascade]');
  });
});

describe('parseDbml on mistakes', () => {
  const errors = (text: string) => parseDbml(text).errors.map((e) => `${e.line}:${e.column} ${e.message}`);

  it('reports a bad line with its line and column, and still reads the rest', () => {
    const { schema, errors: errs } = parseDbml(fixture('broken/one-bad-line.dbml'));
    expect(errs.map((e) => `${e.line}:${e.column} ${e.message}`)).toEqual([`3:17 "nonsense" isn't a column setting`, '4:8 The column "email" needs a type, such as varchar or integer']);
    expect(table(schema, 'users').columns.map((c) => c.name)).toEqual(['id', 'name', 'age']);
    expect(col(schema, 'users', 'name').notNull).toBe(true);
    expect(table(schema, 'orders').columns).toHaveLength(2);
    expect(schema.refs).toHaveLength(1);
  });

  it('reports a table never closed, and reads the tables after it', () => {
    const { schema, errors: errs } = parseDbml(fixture('broken/unclosed.dbml'));
    expect(errs.map((e) => `${e.line}:${e.column} ${e.message}`)).toEqual(['1:13 The table "users" is never closed with }']);
    expect(schema.tables.map((t) => t.name)).toEqual(['users', 'orders']);
    expect(schema.refs).toHaveLength(1);
  });

  it('reports names that point nowhere', () => {
    expect(errors(fixture('broken/unknown-names.dbml'))).toEqual([
      '5:6 The table "orders" has no column "user_id"',
      '6:6 The table "users" has no column "nope"',
      '9:3 There is no TablePartial called "missing_partial"',
      '15:3 There is no table called "ghosts"',
      '18:1 The table "users" has no column "name"',
    ]);
  });

  it('skips what isn’t DBML to the next element', () => {
    const { schema, errors: errs } = parseDbml(fixture('broken/garbage.dbml'));
    expect(errs).toHaveLength(3);
    expect(errs[0]!.line).toBe(1);
    expect(schema.tables.map((t) => t.name)).toEqual(['users', 'orders']);
  });

  it.each([
    ['Table t {\n  a int [default: x]\n}', '2:10 A default is a number, a quoted string, a `backtick expression`, true, false or null'],
    ['Table t {\n  a int\n  a text\n}', '3:3 The table "t" has two columns called "a"'],
    ['Table t {\n  a int\n}\nTable t {\n  b int\n}', '4:7 There are two tables called "t"'],
    ['Table a {\n  x int\n}\nTable b {\n  x int\n  y int\n}\nRef: a.(x) > b.(x, y)', '8:1 This ref matches 1 columns to 2'],
    ['Table a {\n  x int\n}\nRef: a.x > b.x', '4:12 There is no table called "b"'],
    ['Table a {\n  x int [ref: > a]\n}', '2:17 "a" needs its table and column, such as users.id'],
    ['Table a {\n  x int\n}\nRef: a.x >> a.x', '4:11 Expected a table and column, such as users.id but found ">"'],
    ['Table a {\n  x int\n}\nRef: a.x > a.x [delete: explode]', '4:17 "explode" isn\'t an action: use cascade, restrict, set null, set default or no action'],
    ['Table a [headercolor: blue] {\n  x int\n}', '1:10 The setting "headercolor" takes a colour such as #3498DB'],
    ['Table a [owner] {\n  x int\n}', '1:10 "owner" isn\'t a table setting'],
    ['Table a [owner: "x", owner: "y"] {\n  x int\n}', '1:22 The property "owner" is set twice'],
    ['enum e {\n  a\n  a\n}', '3:3 "a" is in the enum "e" twice'],
    ['Table a {\n  x int\n  records {\n    1, 2\n  }\n}', '4:5 This row has 2 values for 1 columns'],
    ["use * from 'other'\nTable a {\n  x int\n}", '1:1 Puddle reads one DBML document: paste the other file’s DBML here instead of importing it'],
    ['/* never closed\nTable a {\n  x int\n}', '1:1 This comment is never closed with */'],
  ])('%j', (text, error) => {
    expect(errors(text)).toEqual([error]);
  });

  it('reports a string never closed, and the settings it leaves open, without losing the table', () => {
    const { schema, errors: errs } = parseDbml("Table t {\n  a int [note: 'x\n  b int\n}\nTable u {\n  c int\n}");
    expect(errs.map((e) => `${e.line}:${e.column} ${e.message}`)).toEqual(['2:9 These settings are never closed with ]', "2:16 This string is never closed with '"]);
    expect(schema.tables.map((t) => t.name)).toEqual(['t', 'u']);
  });

  it('reads an empty document as an empty schema', () => {
    expect(parseDbml('')).toEqual({ schema: { tables: [], refs: [], enums: [], groups: [], notes: [], partials: [], records: [], views: [] }, errors: [] });
    expect(parseDbml('// only a comment\n\n').errors).toEqual([]);
  });
});

/** Zod drops keys whose value is undefined; so does JSON. */
function withoutUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
