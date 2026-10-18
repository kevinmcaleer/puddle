import { readFileSync, readdirSync } from 'node:fs';
import { dbmlName, dbmlString, dbmlType, emptySchema, parseDbml, withoutRanges, writeDbml, type DbmlSchema } from '.';

const dir = 'tests/fixtures/dbml/';

describe('writeDbml', () => {
  it.each(readdirSync(dir).filter((f) => f.endsWith('.dbml')))('round-trips %s: parsing what it writes gives the same model', (name) => {
    const first = parseDbml(readFileSync(`${dir}${name}`, 'utf8'));
    expect(first.errors).toEqual([]);
    const written = writeDbml(first.schema);
    const second = parseDbml(written);
    expect(second.errors).toEqual([]);
    expect(withoutRanges(second.schema)).toEqual(withoutRanges(first.schema));
    // And writing is stable: the second text is the first.
    expect(writeDbml(second.schema)).toBe(written);
  });

  it('writes the shop example as readable DBML', () => {
    const { schema } = parseDbml(readFileSync(`${dir}shop.dbml`, 'utf8'));
    const text = writeDbml(schema);
    expect(text).toContain(`Table customers as C [headercolor: #3498DB] {
  id integer [pk, increment]
  email varchar(255) [not null, unique]
  name varchar(100) [not null]
  country char(2) [default: 'GB']
  created_at timestamp [default: \`now()\`]

  Note: 'Everyone who has signed up'
}`);
    expect(text).toContain('  customer_id integer [not null, ref: > customers.id]');
    expect(text).toContain('Ref: order_items.order_id > orders.id [delete: cascade]');
    expect(text).toContain('TableGroup sales [color: #79AD51] {\n  orders\n  order_items\n}');
  });

  it('writes an empty schema as nothing', () => {
    expect(writeDbml(emptySchema())).toBe('');
  });

  it('writes names, types and strings so they read back the same', () => {
    const schema: DbmlSchema = {
      ...emptySchema(),
      tables: [
        {
          schema: 'sales data',
          name: 'Order "lines"',
          properties: { owner: 'Kev\'s "team"' },
          columns: [
            { name: 'note', type: 'double precision', pk: false, unique: false, increment: false, checks: [], properties: {}, note: "it's\nmulti-line\n  indented\n\nwith a gap and a \\ and '''" },
            { name: 'größe', type: 'NUMERIC(10, 2)', pk: false, unique: false, increment: false, checks: [], properties: {}, default: { kind: 'string', value: "O'Brien" } },
            { name: '2fa', type: 'STRUCT(a INTEGER)', pk: false, unique: false, increment: false, checks: [], properties: {} },
          ],
          indexes: [],
          checks: [],
          partials: [],
        },
      ],
    };
    const text = writeDbml(schema);
    const back = parseDbml(text);
    expect(back.errors).toEqual([]);
    expect(withoutRanges(back.schema)).toEqual(schema);
  });

  it('quotes only what needs quoting', () => {
    expect(dbmlName('users')).toBe('users');
    expect(dbmlName('first name')).toBe('"first name"');
    expect(dbmlName('Note')).toBe('"Note"');
    expect(dbmlName('indexes')).toBe('"indexes"');
    expect(dbmlName('say "hi"')).toBe('"say \\"hi\\""');
    expect(dbmlType('varchar(255)')).toBe('varchar(255)');
    expect(dbmlType('decimal(10, 2)')).toBe('decimal(10, 2)');
    expect(dbmlType('int[]')).toBe('int[]');
    expect(dbmlType('v2.job_status')).toBe('v2.job_status');
    expect(dbmlType('double precision')).toBe('"double precision"');
    expect(dbmlString("it's")).toBe("'it\\'s'");
    expect(dbmlString('a\nb')).toBe("'''\n  a\n  b\n'''");
  });
});
