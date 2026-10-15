// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useFlowStore, useNodeStatus } from './status';

describe('useNodeStatus', () => {
  // Regression: a fresh fallback object per call made React re-render forever ("Maximum update depth").
  it('returns the same pending status for a node with no entry yet', () => {
    const { result, rerender } = renderHook(() => useNodeStatus('nowhere'));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(first).toEqual({ state: 'pending' });
  });

  it('follows the store', () => {
    const { result } = renderHook(() => useNodeStatus('n'));
    act(() => useFlowStore.setState({ nodes: { n: { key: 'k', status: { state: 'unwired' } } } }));
    expect(result.current).toEqual({ state: 'unwired' });
  });
});
