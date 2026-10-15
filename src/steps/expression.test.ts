import { describe, expect, it } from 'vitest';
import { insertColumn, suggest, wordAt } from './expression';
import { freeName } from './columns';
import { newStep } from '.';

const columns = [
  { name: 'email', type: 'VARCHAR' },
  { name: 'joined', type: 'VARCHAR' },
  { name: 'Order Total', type: 'DOUBLE' },
  { name: 'reemail', type: 'VARCHAR' },
];

describe('expression completion', () => {
  it('finds the word before the caret, including an open quoted name', () => {
    expect(wordAt('upper(em', 8)).toEqual({ word: 'em', start: 6 });
    expect(wordAt('1 + "Order T', 12)).toEqual({ word: 'Order T', start: 4 });
    expect(wordAt('1 + ', 4)).toEqual({ word: '', start: 4 });
  });

  it('suggests names that start with the word first, then ones that contain it', () => {
    expect(suggest(columns, 'em').map((c) => c.name)).toEqual(['email', 'reemail']);
    expect(suggest(columns, 'order').map((c) => c.name)).toEqual(['Order Total']);
    expect(suggest(columns, '')).toEqual([]);
    expect(suggest(columns, 'email').map((c) => c.name)).toEqual(['reemail']);
  });

  it('inserts the column in place of the word, quoting names that need it', () => {
    expect(insertColumn('upper(em)', 8, 'email')).toEqual({ text: 'upper(email)', caret: 11 });
    expect(insertColumn('1 + Or', 6, 'Order Total')).toEqual({ text: '1 + "Order Total"', caret: 17 });
  });
});

describe('columns step defaults', () => {
  const ctx = { selected: [], available: [{ name: 'id', type: 'BIGINT' }, { name: 'name', type: 'VARCHAR' }, { name: 'index', type: 'BIGINT' }] };

  it('new columns get names that are not taken', () => {
    expect(freeName('index', ctx)).toBe('index_2');
    expect(freeName('row', ctx)).toBe('row');
    expect(newStep('addIndex', ctx).params).toEqual({ name: 'index_2', start: 1 });
    expect(newStep('splitByDelimiter', ctx).params).toMatchObject({ column: 'name', into: ['name_1', 'name_2'] });
    expect(newStep('duplicateColumn', { ...ctx, selected: ['id'] }).params).toEqual({ column: 'id', into: 'id_copy' });
  });
});
