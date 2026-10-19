// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toolbar } from './Toolbar';

describe('Toolbar', () => {
  afterEach(cleanup);

  it('makes the wordmark the way to every project when onHome is given (principle 8)', () => {
    const home = vi.fn();
    render(<Toolbar project="Shop" onHome={home} />);
    fireEvent.click(screen.getByRole('button', { name: 'Puddle: all projects' }));
    expect(home).toHaveBeenCalledOnce();
  });

  it('keeps the wordmark as plain text without onHome', () => {
    render(<Toolbar project="Shop" />);
    expect(screen.queryByRole('button', { name: /all projects/ })).toBeNull();
    expect(screen.getByText('Puddle').tagName).toBe('SPAN');
  });
});
