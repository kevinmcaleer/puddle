// Generated rows written as DBML records blocks: read back by the parser as the same rows.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDbml } from '../parse';
import { generateRows } from './generate';
import { addRecords, fillRecords, recordsBlock } from './records';

const shopText = readFileSync(join(__dirname, '../../../tests/fixtures/dbml/shop.dbml'), 'utf8');

describe('writing generated rows as records', () => {
  it('writes a top-level block that parses back to the same rows', () => {
    const shop = parseDbml(shopText).schema;
    const g = generateRows(shop, shop.tables.map((t) => `table:public.${t.name}`), { rows: 100, seed: 21 });
    const text = addRecords(shopText, g.tables.map((t) => recordsBlock(t, { example: false })));
    const { schema, errors } = parseDbml(text);
    expect(errors).toEqual([]);
    for (const t of g.tables) {
      const r = schema.records.find((x) => x.table === t.table)!;
      expect(r).toMatchObject({ columns: t.columns, example: false, inline: false });
      expect(r.rows).toEqual(t.rows);
    }
    // Everything before the records is left as it was.
    expect(text.startsWith(`${shopText.trimEnd()}\n\nrecords customers(id, email, name, country) {\n  1, '`)).toBe(true);
  });

  it('marks example records, and quotes names and text that need it', () => {
    const block = recordsBlock(
      { schema: 'v2', table: 'order lines', columns: ['id', 'note'], rows: [[{ kind: 'number', value: '1' }, { kind: 'string', value: "Dan's" }], [{ kind: 'number', value: '2' }, { kind: 'null', value: 'null' }]] },
      { example: true },
    );
    expect(block).toBe(`records v2."order lines"(id, "note") [example] {\n  1, 'Dan\\'s'\n  2, null\n}`);
    const { schema, errors } = parseDbml(addRecords('Table v2."order lines" {\n  id int [pk]\n  note text\n}\n', [block]));
    expect(errors).toEqual([]);
    expect(schema.records[0]).toMatchObject({ schema: 'v2', table: 'order lines', example: true, rows: [[{ kind: 'number', value: '1' }, { kind: 'string', value: "Dan's" }], [{ kind: 'number', value: '2' }, { kind: 'null', value: 'null' }]] });
  });

  it('appends after one blank line, and leaves the text alone with no blocks', () => {
    expect(addRecords('Table a {\n  id int\n}\n\n\n', ['records a(id) {\n  1\n}', 'records b(id) {\n  2\n}'])).toBe('Table a {\n  id int\n}\n\nrecords a(id) {\n  1\n}\n\nrecords b(id) {\n  2\n}\n');
    expect(addRecords('', ['records a(id) {\n  1\n}'])).toBe('records a(id) {\n  1\n}\n');
    expect(addRecords('Table a {}\n', [])).toBe('Table a {}\n');
  });

  it('adds to a table that has records in its one block, inline or top level, keeping both sets of columns', () => {
    const text = [
      'Table a {',
      '  id int [pk]',
      '  name text',
      '  records {',
      '    1, \'x\'',
      '  }',
      '}',
      'Table b {',
      '  id int [pk]',
      '  code text',
      '}',
      'records b(id) [example] {',
      '  7',
      '}',
      '',
    ].join('\n');
    const schema = parseDbml(text).schema;
    const g = generateRows(schema, ['table:public.a', 'table:public.b'], { rows: 3, seed: 1 });
    const filled = fillRecords(text, schema, g.tables, { example: false });
    const back = parseDbml(filled);
    expect(back.errors).toEqual([]);
    const a = back.schema.records.find((r) => r.table === 'a')!;
    expect(a.rows).toHaveLength(4);
    expect(a.rows[0]!.map((v) => v.value)).toEqual(['1', 'x']);
    const b = back.schema.records.find((r) => r.table === 'b')!;
    expect(b.example).toBe(true);
    expect(b.columns).toEqual(['id', 'code']);
    expect(b.rows).toHaveLength(4);
    expect(b.rows[0]!.map((v) => v.kind)).toEqual(['number', 'null']);
  });
});
