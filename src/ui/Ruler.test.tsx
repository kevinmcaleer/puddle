// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ruler } from './Ruler';

afterEach(cleanup);

const LINES = ['CUSTNO  NAME', '000123  Ada'];

describe('Ruler', () => {
  it('shows the lines with a marker at each boundary, named by its offset', () => {
    render(<Ruler lines={LINES} boundaries={[8]} onAdd={() => {}} onMove={() => {}} onRemove={() => {}} />);
    expect(screen.getByRole('group', { name: 'Column boundaries' })).toHaveAttribute('data-boundaries', '8');
    expect(screen.getByRole('button', { name: 'Boundary at 8' })).toBeInTheDocument();
    expect(screen.getByTestId('ruler-lines')).toHaveTextContent('CUSTNO NAME');
  });

  it('moves a focused marker with the arrow keys, inside the lines, and removes it with Delete', () => {
    const onMove = vi.fn();
    const onRemove = vi.fn();
    render(<Ruler lines={LINES} boundaries={[1, 8, 12]} onAdd={() => {}} onMove={onMove} onRemove={onRemove} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Boundary at 8' }), { key: 'ArrowRight' });
    expect(onMove).toHaveBeenLastCalledWith(8, 9);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Boundary at 8' }), { key: 'ArrowLeft' });
    expect(onMove).toHaveBeenLastCalledWith(8, 7);
    // The first offset and the lines' width are as far as a marker goes.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Boundary at 1' }), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Boundary at 12' }), { key: 'ArrowRight' });
    expect(onMove).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Boundary at 8' }), { key: 'Delete' });
    expect(onRemove).toHaveBeenCalledWith(8);
  });

  it('adds a boundary where the lines are clicked, never on one that is there', () => {
    const onAdd = vi.fn();
    render(<Ruler lines={LINES} boundaries={[8]} onAdd={onAdd} onMove={() => {}} onRemove={() => {}} />);
    const lines = screen.getByTestId('ruler-lines');
    // jsdom lays nothing out: the probe measures 0 wide, so the fallback of 7.2px a character places the click.
    lines.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 36, right: 100, bottom: 36, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(lines, { clientX: 4 * 7.2 });
    expect(onAdd).toHaveBeenCalledWith(4);
    fireEvent.click(lines, { clientX: 8 * 7.2 });
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
