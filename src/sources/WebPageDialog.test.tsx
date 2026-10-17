// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebPageDialog } from './WebPageDialog';
import { openWebPageDialog } from './webPageDialog';

beforeAll(() => {
  // jsdom has <dialog> but not its modal methods.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

afterEach(() => {
  cleanup();
  openWebPageDialog(false);
});

const TABLE = '<table><tr><th>Item</th><th>Price</th></tr><tr><td>Tea</td><td>2.50</td></tr><tr><td>Cake</td><td>3.10</td></tr></table>';

function openPaste() {
  act(() => openWebPageDialog());
  render(<WebPageDialog />);
  fireEvent.click(screen.getByRole('button', { name: 'Paste a copied table instead' }));
  return screen.getByLabelText('Pasted table') as HTMLTextAreaElement;
}

describe('pasting a table copied from a page', () => {
  it('reads the HTML the clipboard holds, not its text, and shows the table at once', () => {
    const box = openPaste();
    const paste = fireEvent.paste(box, { clipboardData: { getData: (type: string) => (type === 'text/html' ? `<meta charset="utf-8">${TABLE}` : 'Item\tPrice\nTea\t2.50\nCake\t3.10') } });
    // Handled here, so the browser doesn't also paste the text.
    expect(paste).toBe(false);
    expect(screen.getByTestId('web-table-preview').textContent).toContain('Cake');
    expect(screen.getByRole('button', { name: 'Add source' })).toBeTruthy();
  });

  it('leaves a paste with no HTML to the text box, and says when no table is in it', () => {
    const box = openPaste();
    expect(fireEvent.paste(box, { clipboardData: { getData: (type: string) => (type === 'text/html' ? '' : 'just text') } })).toBe(true);
    fireEvent.change(box, { target: { value: 'just text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find tables' }));
    expect(screen.getByTestId('web-error').textContent).toContain('There’s no table in what you pasted');
  });
});
