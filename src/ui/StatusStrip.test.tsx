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

describe('StatusStrip for screen readers', () => {
  it('reads out the counts and rule results as they change, but not the timer and Stop at its end', () => {
    render(<StatusStrip rows={4} cols={3} rules={{ pass: 1, warn: 0, fail: 1 }} end={<span data-testid="end">Counting rows · 2s</span>} />);
    const live = screen.getByRole('status');
    expect(live).toHaveTextContent('4 rows');
    expect(live).toHaveTextContent('3 cols');
    expect(live).toHaveTextContent('1 fail');
    expect(live).not.toContainElement(screen.getByTestId('end'));
    expect(live.closest('footer')).not.toBeNull();
  });
});
