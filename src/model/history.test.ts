import { canRedo, canUndo, initHistory, pushHistory, redo, undo } from './history';

describe('history', () => {
  it('undoes and redoes snapshots in order', () => {
    let h = initHistory(1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(true);
  });

  it('drops the redo branch on a new edit and caps the past', () => {
    let h = initHistory(0);
    for (let i = 1; i <= 5; i++) h = pushHistory(h, i, 3);
    expect(h.past).toEqual([2, 3, 4]);
    h = pushHistory(undo(h), 99, 3);
    expect(h.future).toEqual([]);
    expect(h.present).toBe(99);
  });

  it('ignores no-op edits and empty undo or redo', () => {
    const h = initHistory({ a: 1 });
    expect(pushHistory(h, h.present)).toBe(h);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
});
