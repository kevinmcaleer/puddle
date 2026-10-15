import { useProjectStore } from './store';

describe('project store', () => {
  it('makes every applied edit undoable', () => {
    const s = useProjectStore.getState();
    const before = s.history.present;
    s.apply((p) => ({ ...p, name: 'Renamed' }));
    expect(useProjectStore.getState().history.present.name).toBe('Renamed');
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().history.present).toBe(before);
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().history.present.name).toBe('Renamed');
  });

  it('records no step when an edit changes nothing', () => {
    const s = useProjectStore.getState();
    const past = s.history.past.length;
    s.apply((p) => p);
    expect(useProjectStore.getState().history.past.length).toBe(past);
  });
});
