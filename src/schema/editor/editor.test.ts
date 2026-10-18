import { readFileSync } from 'node:fs';
import { parseDbml } from '..';
import { completions, enclosingBlock } from './completion';
import { highlightDbml, matchingBracket } from './highlight';

const shop = parseDbml(readFileSync('tests/fixtures/dbml/shop.dbml', 'utf8')).schema;

describe('highlightDbml', () => {
  const kinds = (text: string) => highlightDbml(text).map((s) => `${s.kind}:${text.slice(s.start, s.end)}`);

  it('colours keywords, names, types, settings and values', () => {
    expect(kinds("// shop\nTable core.users as U [headercolor: #fff] {\n  id integer [pk, default: 1, note: 'x']\n}")).toEqual([
      'comment:// shop',
      'keyword:Table',
      'name:core',
      'name:users',
      'keyword:as',
      'name:U',
      'punct:[',
      'setting:headercolor',
      'color:#fff',
      'punct:]',
      'punct:{',
      'name:id',
      'type:integer',
      'punct:[',
      'setting:pk',
      'setting:default',
      'number:1',
      'setting:note',
      "string:'x'",
      'punct:]',
      'punct:}',
    ]);
  });

  it('colours refs and expressions', () => {
    expect(kinds('Ref: a.b > c.d [delete: cascade]\nTable t {\n  c int [default: `now()`]\n}')).toEqual([
      'keyword:Ref',
      'name:a',
      'name:b',
      'op:>',
      'name:c',
      'name:d',
      'punct:[',
      'setting:delete',
      'name:cascade',
      'punct:]',
      'keyword:Table',
      'name:t',
      'punct:{',
      'name:c',
      'type:int',
      'punct:[',
      'setting:default',
      'expr:`now()`',
      'punct:]',
      'punct:}',
    ]);
  });
});

describe('matchingBracket', () => {
  const text = 'Table t {\n  a int [pk]\n}';
  it('finds the partner of the bracket at or before the caret', () => {
    expect(matchingBracket(text, 8)).toEqual([8, 23]);
    expect(matchingBracket(text, 24)).toEqual([8, 23]);
    expect(matchingBracket(text, 18)).toEqual([18, 21]);
    expect(matchingBracket(text, 3)).toBeUndefined();
  });
});

describe('completions', () => {
  const at = (text: string) => {
    const caret = text.indexOf('|');
    return completions(text.replace('|', ''), caret, shop);
  };
  const labels = (text: string) => at(text).items.map((i) => i.label);

  it('suggests element keywords at the top level', () => {
    expect(labels('Ta|')).toEqual(['Table', 'TableGroup', 'TablePartial']);
    expect(at('Ta|').start).toBe(0);
  });

  it('suggests what a table holds at the start of a line in one', () => {
    expect(labels('Table t {\n  in|\n}')).toEqual(['indexes']);
  });

  it('suggests types, enums first, after a column name', () => {
    expect(labels('Table t {\n  status ord|\n}')).toEqual(['order_status']);
    expect(labels('Table t {\n  id big|\n}')).toEqual(['bigint']);
  });

  it('suggests column settings in brackets', () => {
    expect(labels('Table t {\n  id int [no|\n}')).toEqual(['not null', 'note:']);
    expect(labels('Table t {\n  id int [pk, un|\n}')).toEqual(['unique']);
  });

  it('suggests table columns where a ref names one', () => {
    expect(labels('Ref: order_items.order_id > orders.i|')).toEqual(['orders.id']);
    expect(labels('Table t {\n  c int [ref: > customers.em|\n}')).toEqual(['customers.email']);
    expect(labels('Ref: cust|')).toContain('customers.id');
  });

  it('suggests tables in a group and the table’s columns in its indexes', () => {
    expect(labels('TableGroup g {\n  ord|\n}')).toEqual(['orders', 'order_items']);
    expect(labels('Table orders {\n  indexes {\n    st|\n  }\n}')).toEqual(['status', 'customer_id']);
  });

  it('suggests nothing inside a note, and only longer words once one is complete', () => {
    expect(labels("Note n {\n  'ta|'\n}")).toEqual([]);
    expect(labels('Table|')).toEqual(['TableGroup', 'TablePartial']);
  });
});

describe('enclosingBlock', () => {
  it('names the innermost open block', () => {
    expect(enclosingBlock('')).toBeNull();
    expect(enclosingBlock('Table core.users as U {\n  id int\n  indexes {\n')).toBe('indexes');
    expect(enclosingBlock('Table t {\n}\n')).toBeNull();
  });
});
