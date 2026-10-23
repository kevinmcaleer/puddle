import { beforeEach, describe, expect, it } from 'vitest';
import { useSession } from './session';

describe('showIssues', () => {
  beforeEach(() => useSession.setState({ selectedNodeId: null, selectedNodeIds: [], inspectorTab: 'project', inspectorOpen: false, browsingConnectionId: 'c1', revealIssues: null }));

  it('selects the node and opens its Node tab with the Issues list to bring into view', () => {
    useSession.getState().showIssues('n1');
    const s = useSession.getState();
    expect(s).toMatchObject({ selectedNodeId: 'n1', selectedNodeIds: ['n1'], inspectorTab: 'node', inspectorOpen: true, browsingConnectionId: null, revealIssues: 'n1' });
    s.clearRevealIssues();
    expect(useSession.getState().revealIssues).toBeNull();
  });
});
