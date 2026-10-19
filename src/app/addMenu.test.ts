import { describe, expect, it } from 'vitest';
import { afterSelection, SELECT_A_NODE_FIRST } from './addMenu';

const items = [
  { label: 'Output', hint: undefined, onSelect: () => undefined },
  { label: 'Join', hint: 'Two inputs', onSelect: () => undefined },
];

describe('the Add menu’s nodes and steps (principle 2: never an unwired node)', () => {
  it('are offered as they are once a node is selected', () => {
    expect(afterSelection(items, true)).toBe(items);
  });

  it('wait, saying why, while nothing is selected', () => {
    expect(afterSelection(items, false).map((i) => [i.label, i.disabled, i.hint])).toEqual([
      ['Output', true, SELECT_A_NODE_FIRST],
      ['Join', true, SELECT_A_NODE_FIRST],
    ]);
  });
});
