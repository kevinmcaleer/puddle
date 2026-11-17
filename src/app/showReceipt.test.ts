import { beforeEach, describe, expect, it } from 'vitest';
import { useSession } from './session';

describe('showReceipt', () => {
  beforeEach(() => useSession.setState({ selectedNodeId: 'last', selectedNodeIds: ['last'], inspectorTab: 'project', inspectorOpen: false, browsingConnectionId: 'c1', receiptNodeId: null }));

  it('opens the inspector on its Node tab, where the receipt stands, keeping the selection', () => {
    useSession.getState().showReceipt('src');
    expect(useSession.getState()).toMatchObject({ receiptNodeId: 'src', selectedNodeId: 'last', inspectorTab: 'node', inspectorOpen: true, browsingConnectionId: null });
  });

  it('is put away by closing it, picking a node, adding to the selection, asking for a node’s issues or another tab', () => {
    const { showReceipt, select, toggleSelected, showIssues, setInspectorTab } = useSession.getState();
    for (const away of [() => showReceipt(null), () => select('last'), () => toggleSelected('other'), () => showIssues('src'), () => setInspectorTab('notes')]) {
      showReceipt('src');
      away();
      expect(useSession.getState().receiptNodeId).toBeNull();
    }
  });
});
