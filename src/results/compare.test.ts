import { describe, expect, it, vi } from 'vitest';
import { follow, onlyHere, ScrollSync, supersedeKey } from './compare';

describe('onlyHere', () => {
  it('lists the columns the other side lacks', () => {
    expect([...onlyHere(['id', 'name', 'total'], ['id', 'name', 'city'])]).toEqual(['total']);
    expect([...onlyHere(['id', 'name', 'city'], ['id', 'name', 'total'])]).toEqual(['city']);
  });

  it('marks nothing until the other side is known, or when the columns match', () => {
    expect(onlyHere(['id'], undefined).size).toBe(0);
    expect(onlyHere(['id', 'name'], ['name', 'id']).size).toBe(0);
  });
});

describe('ScrollSync', () => {
  it('tells the other pane, never the one that scrolled', () => {
    const sync = new ScrollSync();
    const main = vi.fn();
    const compare = vi.fn();
    sync.on('main', main);
    sync.on('compare', compare);
    sync.publish('main', { row: 40, column: 'id' });
    expect(compare).toHaveBeenCalledWith({ row: 40, column: 'id' });
    expect(main).not.toHaveBeenCalled();
  });

  it('stops telling a pane once it unsubscribes', () => {
    const sync = new ScrollSync();
    const compare = vi.fn();
    const off = sync.on('compare', compare);
    off();
    sync.publish('main', { row: 1 });
    expect(compare).not.toHaveBeenCalled();
  });
});

describe('follow', () => {
  it('scrolls to the same row and column where this side has the column', () => {
    expect(follow({ row: 12, column: 'city' }, ['id', 'name', 'city'], 0)).toEqual({ col: 2, row: 12, horizontal: true });
  });

  it('follows only the row when this side lacks the column', () => {
    expect(follow({ row: 12, column: 'total' }, ['id', 'name', 'city'], 1)).toEqual({ col: 1, row: 12, horizontal: false });
    expect(follow({ row: 3 }, ['id'], 0)).toEqual({ col: 0, row: 3, horizontal: false });
  });
});

describe('supersedeKey', () => {
  it('keeps the main pane on the keys the single table always used, and gives the other pane its own', () => {
    expect(supersedeKey('main', 'preview')).toBe('preview');
    expect(supersedeKey('main', 'profile')).toBe('profile');
    expect(supersedeKey('compare', 'preview')).not.toBe('preview');
    expect(supersedeKey('compare', 'profile')).not.toBe('profile');
  });
});
