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

describe('NodeCard kept result', () => {
  afterEach(cleanup);

  it('shows the memory a kept result uses in the metric line', () => {
    render(<NodeCard kind="transform" name="Clean" rows={1200} cols={4} kept={{ label: '5.1 MB kept' }} />);
    const kept = screen.getByTestId('node-kept');
    expect(kept.textContent).toBe(' · 5.1 MB kept');
    expect(kept.closest('.ui-metric')!.textContent).toBe('1,200 rows · 4 cols · 5.1 MB kept');
  });

  it('says when a kept result is out of date, even before the row count is known', () => {
    render(<NodeCard kind="join" name="Join" kept={{ label: 'Kept · out of date', stale: true }} />);
    const kept = screen.getByTestId('node-kept');
    expect(kept.textContent).toBe('Kept · out of date');
    expect(kept.dataset.stale).toBe('true');
  });
});
