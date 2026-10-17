// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Dialog } from './Dialog';

beforeAll(() => {
  // jsdom has <dialog> but not its modal methods.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

afterEach(cleanup);

function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Rename</button>
      {open && (
        <Dialog title="Rename project" confirm="Rename" onClose={() => setOpen(false)} onConfirm={() => setOpen(false)}>
          <input aria-label="Name" data-autofocus />
        </Dialog>
      )}
    </>
  );
}

describe('Dialog', () => {
  it('starts on the field marked data-autofocus and gives focus back to its opener when it closes', () => {
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Rename' });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab inside, through each control and round from the last to the first, and Shift+Tab back', () => {
    render(<Opener />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const field = screen.getByLabelText('Name');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const submit = document.querySelector<HTMLButtonElement>('dialog button[type="submit"]')!;
    const tab = (shiftKey = false) => fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey });
    tab();
    expect(document.activeElement).toBe(cancel);
    tab();
    expect(document.activeElement).toBe(submit);
    tab();
    expect(document.activeElement).toBe(field);
    tab(true);
    expect(document.activeElement).toBe(submit);
  });

  it('names itself after its title', () => {
    render(<Dialog title="Keyboard shortcuts" onClose={() => undefined} />);
    expect(document.querySelector('dialog')).toHaveAttribute('aria-label', 'Keyboard shortcuts');
  });
});
