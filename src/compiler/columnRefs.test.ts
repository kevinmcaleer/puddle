import { describe, expect, it } from 'vitest';
import { renameSqlColumns, sqlColumnRefs } from './columnRefs';

describe('columns named in SQL', () => {
  it('finds bare and quoted column names, ignoring case, in the order given', () => {
    expect(sqlColumnRefs('price * "Quantity" + tax', ['tax', 'quantity', 'price', 'total'])).toEqual(['tax', 'quantity', 'price']);
  });

  it('skips functions, strings, comments, table names before a dot and new names after AS', () => {
    const sql = "SELECT upper(name) AS total, input.email, 'price' -- quantity\nFROM input";
    expect(sqlColumnRefs(sql, ['name', 'upper', 'total', 'email', 'price', 'quantity', 'input'])).toEqual(['name', 'email']);
  });

  it('names nothing in text the lexer refuses', () => {
    expect(sqlColumnRefs("E'x' || name", ['name'])).toEqual([]);
  });

  it('renames columns, quoting the new name only when it has to be', () => {
    expect(renameSqlColumns('price * quantity', { price: 'unit_price', quantity: 'Qty Ordered' })).toBe('unit_price * "Qty Ordered"');
    expect(renameSqlColumns('"Price" + PRICE', { price: 'cost' })).toBe('"cost" + cost');
  });

  it('leaves strings, comments, functions and aliases exactly as written', () => {
    const sql = "SELECT name, 'name' AS name2, lower(name) AS name -- name\nFROM input";
    expect(renameSqlColumns(sql, { name: 'full_name' })).toBe("SELECT full_name, 'name' AS name2, lower(full_name) AS name -- name\nFROM input");
  });

  it('renames each name once, so swapped names do not chain', () => {
    expect(renameSqlColumns('a - b', { a: 'b', b: 'a' })).toBe('b - a');
  });
});
