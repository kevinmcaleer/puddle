// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuleRow } from './RuleRow';

describe('RuleRow as a suggestion', () => {
  afterEach(cleanup);

  it('shows the reason with Add and Dismiss, and no result', () => {
    const onAdd = vi.fn();
    const onDismiss = vi.fn();
    const { container } = render(<RuleRow name="status is one of open, closed" suggestion={{ reason: 'status has 2 distinct values', onAdd, onDismiss }} />);
    expect(container.querySelector('.ui-rule')!.getAttribute('data-status')).toBe('suggested');
    expect(screen.getByText('Suggested')).toBeTruthy();
    expect(screen.getByText('status has 2 distinct values')).toBeTruthy();
    expect(screen.queryByText(/Pass|Fail|checked/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add suggested rule: status is one of open, closed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss suggestion: status is one of open, closed' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // Regression: the Add button's name began "Add rule", so tests and people looking for the Rules section's
  // "Add rule" menu found every suggestion too.
  it('names its Add button apart from the Add rule menu', () => {
    render(<RuleRow name="id is unique" suggestion={{ reason: 'r', onAdd: () => {}, onDismiss: () => {} }} />);
    expect(screen.queryByRole('button', { name: /^Add rule/ })).toBeNull();
  });
});
