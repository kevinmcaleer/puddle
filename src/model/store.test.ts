import { logExport } from './exports';
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

describe('view and derived facts', () => {
  it('changes the view without an undo step', () => {
    const past = useProjectStore.getState().history.past.length;
    useProjectStore.getState().setView({ viewedNodeId: 'x', viewedStepIndex: 2 });
    const { history } = useProjectStore.getState();
    expect(history.present.view).toMatchObject({ viewedNodeId: 'x', viewedStepIndex: 2 });
    expect(history.past.length).toBe(past);
  });

  it('viewing another node or step stops showing a rule’s failing rows', () => {
    const { setView } = useProjectStore.getState();
    setView({ viewedNodeId: 'x', viewedStepIndex: undefined, failingRuleId: 'r1' });
    expect(useProjectStore.getState().history.present.view.failingRuleId).toBe('r1');
    setView({ pinned: true });
    expect(useProjectStore.getState().history.present.view.failingRuleId).toBe('r1');
    setView({ viewedNodeId: 'y' });
    expect(useProjectStore.getState().history.present.view.failingRuleId).toBeUndefined();
  });

  it('amends the present without an undo step, and keeps it when nothing changes', () => {
    const past = useProjectStore.getState().history.past.length;
    useProjectStore.getState().amend((p) => ({ ...p, notes: 'derived' }));
    expect(useProjectStore.getState().history.present.notes).toBe('derived');
    expect(useProjectStore.getState().history.past.length).toBe(past);
    const before = useProjectStore.getState().history;
    useProjectStore.getState().amend((p) => p);
    expect(useProjectStore.getState().history).toBe(before);
  });

  it('keeps the export log through undo and redo: an export happened either way', () => {
    const s = useProjectStore.getState();
    s.apply((p) => ({ ...p, name: 'Before export' }));
    useProjectStore.getState().amend((p) => logExport(p, { at: '2026-10-15T00:00:00Z', nodeId: 'o', nodeName: 'Out', format: 'csv', fileName: 'Out.csv', rows: 3 }, 'x1'));
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().history.present.name).not.toBe('Before export');
    expect(useProjectStore.getState().history.present.exportLog.map((e) => e.id)).toEqual(['x1']);
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().history.present.exportLog.map((e) => e.id)).toEqual(['x1']);
  });
});
