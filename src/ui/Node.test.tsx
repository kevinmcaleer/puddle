// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeCard } from './Node';

describe('NodeCard note marker', () => {
  afterEach(cleanup);

  it('marks a node that has a note and shows the note on hover', () => {
    render(<NodeCard kind="source" name="orders.csv" note={'Sent weekly <b>by</b> finance.'} />);
    const marker = screen.getByTestId('node-note');
    expect(marker.getAttribute('title')).toBe('Sent weekly <b>by</b> finance.');
    expect(marker.querySelector('b')).toBeNull();
  });

  it('shows no marker without a note', () => {
    render(<NodeCard kind="output" name="Out" />);
    expect(screen.queryByTestId('node-note')).toBeNull();
  });
});

describe('NodeCard pill', () => {
  afterEach(cleanup);

  it('says Viewing, Pinned or Comparing', () => {
    const { rerender } = render(<NodeCard kind="source" name="a" viewed />);
    expect(screen.getByTestId('node-pill').textContent).toBe('Viewing');
    rerender(<NodeCard kind="source" name="a" viewed pinned />);
    expect(screen.getByTestId('node-pill').textContent).toBe('Pinned');
    rerender(<NodeCard kind="source" name="a" comparing />);
    expect(screen.getByTestId('node-pill').textContent).toBe('Comparing');
    rerender(<NodeCard kind="source" name="a" />);
    expect(screen.queryByTestId('node-pill')).toBeNull();
  });
});
