import { beforeEach, describe, expect, it } from 'vitest';
import { inspectorShown, useSession } from './session';

describe('whether the inspector shows', () => {
  beforeEach(() => useSession.setState({ inspectorOpen: null }));

  it('is closed on an empty project and opens once there is a node, until it is opened or closed by hand', () => {
    expect(inspectorShown(null, 0)).toBe(false);
    expect(inspectorShown(null, 1)).toBe(true);
    expect(inspectorShown(true, 0)).toBe(true);
    expect(inspectorShown(false, 3)).toBe(false);
  });

  it('starts with no choice made', () => {
    expect(useSession.getState().inspectorOpen).toBeNull();
  });

  it('counts being asked for a tab, a node’s issues, a receipt or the step search as opening it', () => {
    const { setInspectorTab, showIssues, showReceipt, requestAddStep, setInspectorOpen } = useSession.getState();
    for (const ask of [() => setInspectorTab('project'), () => showIssues('n'), () => showReceipt('n'), () => requestAddStep(), () => setInspectorOpen(true)]) {
      useSession.setState({ inspectorOpen: null });
      ask();
      expect(inspectorShown(useSession.getState().inspectorOpen, 0)).toBe(true);
    }
  });
});
