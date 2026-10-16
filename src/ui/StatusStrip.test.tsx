// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusStrip } from './ResultsBar';

afterEach(cleanup);

describe('StatusStrip sync state', () => {
  it('shows nothing for a project that doesn’t sync', () => {
    render(<StatusStrip rows={3} />);
    expect(screen.queryByTestId('sync-state')).toBeNull();
  });

  it.each([
    ['synced', 'Synced'],
    ['pending', 'Sync pending'],
    ['offline', 'Offline'],
    ['conflict', 'Sync conflict'],
    ['error', 'Sync failed'],
  ] as const)('names the %s state in words, with its detail on hover', (state, text) => {
    render(<StatusStrip sync={state} syncTitle="More" />);
    const badge = screen.getByTestId('sync-state');
    expect(badge).toHaveAttribute('data-state', state);
    expect(badge).toHaveTextContent(text);
    expect(badge.querySelector('[title="More"]')).not.toBeNull();
  });
});
