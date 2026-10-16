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
