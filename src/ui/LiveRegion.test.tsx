// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { announce, useAnnouncements } from './announce';
import { LiveRegions } from './LiveRegion';

afterEach(() => {
  cleanup();
  useAnnouncements.setState({ polite: '', assertive: '' });
});

describe('live regions', () => {
  it('reads polite and assertive news from regions that are always in the page', () => {
    render(<LiveRegions />);
    const [polite, assertive] = [screen.getByTestId('announce-polite'), screen.getByTestId('announce-assertive')];
    expect(polite).toHaveAttribute('aria-live', 'polite');
    expect(assertive).toHaveAttribute('aria-live', 'assertive');
    act(() => announce('Wired customers.csv into Transform 1.'));
    act(() => announce('Transform 1 is broken: Column phone isn’t there.', 'assertive'));
    expect(polite).toHaveTextContent('Wired customers.csv into Transform 1.');
    expect(assertive).toHaveTextContent('Transform 1 is broken');
  });

  it('changes the text when the same news comes twice, so it is read again', () => {
    announce('Wiring cancelled.');
    const first = useAnnouncements.getState().polite;
    announce('Wiring cancelled.');
    const second = useAnnouncements.getState().polite;
    expect(second).not.toBe(first);
    expect(second.trim()).toBe(first);
  });
});
