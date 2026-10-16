import { canRedo, canUndo, checkpoint, initHistory, pushHistory, redo, undo } from './history';

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

  it('turns changes made in place since a snapshot into one undo step', () => {
    let h = pushHistory(initHistory('a'), 'b');
    const before = h.present;
    // Typing amends the present without undo steps.
    h = { ...h, present: 'bc' };
    h = { ...h, present: 'bcd' };
    h = checkpoint(h, before);
    expect(h.past).toEqual(['a', 'b']);
    expect(h.present).toBe('bcd');
    h = undo(h);
    expect(h.present).toBe('b');
    expect(redo(h).present).toBe('bcd');
  });

  it('adds no step when nothing changed since the snapshot, and caps the past', () => {
    const h = initHistory('a');
    expect(checkpoint(h, h.present)).toBe(h);
    let capped = initHistory(0);
    for (let i = 1; i <= 3; i++) capped = pushHistory(capped, i, 3);
    capped = checkpoint({ ...capped, present: 9 }, 3, 3);
    expect(capped.past).toEqual([1, 2, 3]);
  });

  it('drops the redo branch when an editing session closes', () => {
    let h = undo(pushHistory(initHistory('a'), 'b'));
    expect(h.future).toEqual(['b']);
    const before = h.present;
    h = checkpoint({ ...h, present: 'ax' }, before);
    expect(h.future).toEqual([]);
  });
});
