import { describe, expect, it } from 'vitest';
import { snakeName, tidyName, tidyRenames } from './names';

describe('column names', () => {
  it('tidies spaces and hidden characters', () => {
    expect(tidyName(' Customer  name ')).toBe('Customer name');
    expect(tidyName('﻿id')).toBe('id');
    expect(tidyName('Total (GBP)')).toBe('Total (GBP)');
    expect(tidyName('ok')).toBe('ok');
  });

  it('makes snake_case from words, punctuation and camelCase', () => {
    expect(snakeName('Doc. no.')).toBe('doc_no');
    expect(snakeName('Amount in LC')).toBe('amount_in_lc');
    expect(snakeName('orderDate')).toBe('order_date');
    expect(snakeName('CustomerID')).toBe('customer_id');
    expect(snakeName('Unnamed: 3')).toBe('unnamed_3');
    expect(snakeName('already_snake')).toBe('already_snake');
    expect(snakeName('Müller (€)')).toBe('müller');
  });

  it('renames only what is untidy, to names no other column has', () => {
    expect(tidyRenames(['id', ' name ', 'name', 'City'], 'words')).toEqual([{ from: ' name ', to: 'name_1' }]);
    expect(tidyRenames(['id', 'Name', 'order date'], 'snake')).toEqual([{ from: 'Name', to: 'name' }, { from: 'order date', to: 'order_date' }]);
    expect(tidyRenames(['id', 'name'], 'snake')).toEqual([]);
  });
});
