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

  it('makes a session of in-place edits one undo step', () => {
    const before = useProjectStore.getState().history.present;
    const past = useProjectStore.getState().history.past.length;
    for (const notes of ['#', '# P', '# Plan']) useProjectStore.getState().amend((p) => ({ ...p, notes }));
    useProjectStore.getState().checkpoint(before);
    const { history } = useProjectStore.getState();
    expect(history.past.length).toBe(past + 1);
    expect(history.present.notes).toBe('# Plan');
    expect(history.present.updatedAt >= before.updatedAt).toBe(true);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().history.present).toBe(before);
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().history.present.notes).toBe('# Plan');
    const again = useProjectStore.getState().history;
    useProjectStore.getState().checkpoint(again.present);
    expect(useProjectStore.getState().history).toBe(again);
  });

  it('ignores a session that began in another project', () => {
    const other = useProjectStore.getState().history.present;
    useProjectStore.getState().load({ ...other, id: 'another-project', notes: 'theirs' });
    const history = useProjectStore.getState().history;
    useProjectStore.getState().checkpoint(other);
    expect(useProjectStore.getState().history).toBe(history);
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

describe('one operation, one undo step', () => {
  it('batches several edits into one step', () => {
    const before = useProjectStore.getState().history.present;
    const past = useProjectStore.getState().history.past.length;
    const result = useProjectStore.getState().batch(() => {
      useProjectStore.getState().apply((p) => ({ ...p, name: 'One' }));
      useProjectStore.getState().apply((p) => ({ ...p, notes: 'Two' }));
      return 'done';
    });
    expect(result).toBe('done');
    expect(useProjectStore.getState().history.past.length).toBe(past + 1);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().history.present).toBe(before);
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().history.present).toMatchObject({ name: 'One', notes: 'Two' });
  });

  it('batches the edits of an async operation until it settles, and nested batches into the outermost', async () => {
    const before = useProjectStore.getState().history.present;
    const past = useProjectStore.getState().history.past.length;
    await useProjectStore.getState().batch(async () => {
      useProjectStore.getState().apply((p) => ({ ...p, name: 'First file' }));
      await Promise.resolve();
      useProjectStore.getState().batch(() => useProjectStore.getState().apply((p) => ({ ...p, notes: 'Second file' })));
      expect(useProjectStore.getState().history.past.length).toBe(past);
    });
    expect(useProjectStore.getState().history.past.length).toBe(past + 1);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().history.present).toBe(before);
  });

  it('records what was applied before an operation failed, and stops batching', () => {
    const past = useProjectStore.getState().history.past.length;
    expect(() =>
      useProjectStore.getState().batch(() => {
        useProjectStore.getState().apply((p) => ({ ...p, name: 'Half done' }));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(useProjectStore.getState().history.past.length).toBe(past + 1);
    useProjectStore.getState().apply((p) => ({ ...p, name: 'After' }));
    expect(useProjectStore.getState().history.past.length).toBe(past + 2);
  });

  it('records nothing for a batch that changes nothing', () => {
    const history = useProjectStore.getState().history;
    useProjectStore.getState().batch(() => undefined);
    expect(useProjectStore.getState().history).toBe(history);
  });

  it('puts a newer version of the open project in place as an undo step, keeping its updatedAt', () => {
    const before = useProjectStore.getState().history.present;
    const newer = { ...before, name: 'From another browser', updatedAt: '2030-01-01T00:00:00.000Z' };
    useProjectStore.getState().replace(newer);
    expect(useProjectStore.getState().history.present).toBe(newer);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().history.present).toBe(before);
    useProjectStore.getState().replace({ ...before, id: 'elsewhere' });
    expect(useProjectStore.getState().history.past).toEqual([]);
  });

  it('keeps the file a source reads now when undo goes back past a re-attach', () => {
    const source = { id: 's1', name: 'Sales', kind: 'file' as const, format: 'csv' as const, parseOptions: {}, detectedSchema: [], file: { originalName: 'old.csv', size: 1, lastModified: 0, headHash: 'old' } };
    useProjectStore.getState().load({ ...useProjectStore.getState().history.present, sources: [source] });
    useProjectStore.getState().apply((p) => ({ ...p, name: 'Renamed' }));
    // The file is chosen again: a fact, recorded without an undo step.
    useProjectStore.getState().amend((p) => ({ ...p, sources: p.sources.map((s) => ({ ...s, file: { ...s.file!, originalName: 'new.csv', headHash: 'new' } })) }));
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().history.present.name).not.toBe('Renamed');
    expect(useProjectStore.getState().history.present.sources[0]!.file).toMatchObject({ originalName: 'new.csv', headHash: 'new' });
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().history.present.sources[0]!.file?.headHash).toBe('new');
  });
});
