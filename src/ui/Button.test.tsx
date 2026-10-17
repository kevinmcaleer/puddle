// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './Button';

afterEach(cleanup);

describe('Button', () => {
  it('names an icon-only button by its aria-label, and keeps the icon out of the name', () => {
    render(<Button icon="undo" iconOnly aria-label="Undo" />);
    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('won’t compile an icon-only button without a name', () => {
    // @ts-expect-error An icon-only button must have an aria-label.
    const unnamed = <Button icon="undo" iconOnly />;
    expect(unnamed).toBeTruthy();
  });
});
