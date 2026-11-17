// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../app/session';
import { Description } from './Description';

describe('a description on the canvas', () => {
  beforeEach(() => useSession.getState().askDescribe(null));
  afterEach(cleanup);

  it('shows nothing until there is one, then the words, without markup', () => {
    const { rerender } = render(<Description flowId="n1" name="Transform 1" onSave={() => {}} />);
    expect(screen.queryByTestId('description')).toBeNull();
    rerender(<Description flowId="n1" name="Transform 1" text="combine <b>into</b> one list" onSave={() => {}} />);
    const line = screen.getByTestId('description');
    expect(line.textContent).toBe('combine <b>into</b> one list');
    expect(line.querySelector('b')).toBeNull();
  });

  it('opens for writing when asked, with the words as they are', () => {
    const { rerender } = render(<Description flowId="n1" name="Transform 1" text="combine" onSave={() => {}} />);
    useSession.getState().askDescribe('n1');
    rerender(<Description flowId="n1" name="Transform 1" text="combine" onSave={() => {}} />);
    expect(screen.getByLabelText('Description of Transform 1')).toHaveProperty('value', 'combine');
  });

  it('keeps clicks inside the field from reaching the card', () => {
    const outer = vi.fn();
    useSession.getState().askDescribe('n1');
    render(
      <div onClick={outer} onDoubleClick={outer}>
        <Description flowId="n1" name="Transform 1" text="combine" onSave={() => {}} />
      </div>,
    );
    const input = screen.getByLabelText('Description of Transform 1');
    fireEvent.click(input);
    fireEvent.doubleClick(input);
    expect(outer).not.toHaveBeenCalled();
  });

  it('saves once on Enter, even when the field then loses focus, and closes', () => {
    const save = vi.fn();
    useSession.getState().askDescribe('n1');
    render(<Description flowId="n1" name="Transform 1" onSave={save} />);
    const input = screen.getByLabelText('Description of Transform 1');
    fireEvent.change(input, { target: { value: 'touchless rate per month' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('touchless rate per month');
    expect(useSession.getState().describing).toBeNull();
  });

  it('saves on blur, leaves it as it was on Escape, and saves nothing when only spaces changed', () => {
    const save = vi.fn();
    useSession.getState().askDescribe('n1');
    const { unmount } = render(<Description flowId="n1" name="Transform 1" text="combine" onSave={save} />);
    let input = screen.getByLabelText('Description of Transform 1');
    fireEvent.change(input, { target: { value: 'combine ' } });
    fireEvent.blur(input);
    expect(save).not.toHaveBeenCalled();
    unmount();

    useSession.getState().askDescribe('n1');
    render(<Description flowId="n1" name="Transform 1" text="combine" onSave={save} />);
    input = screen.getByLabelText('Description of Transform 1');
    fireEvent.change(input, { target: { value: 'something else' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(save).not.toHaveBeenCalled();
    expect(useSession.getState().describing).toBeNull();
    expect(screen.getByTestId('description').textContent).toBe('combine');
  });

  it('writes only the description asked for', () => {
    useSession.getState().askDescribe('group:g1');
    render(<Description flowId="n1" name="Transform 1" text="combine" onSave={() => {}} />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
