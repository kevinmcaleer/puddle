// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blockPageSelectAll } from './selectAll';

let remove: () => void;
beforeEach(() => {
  document.body.innerHTML = `
    <header><h1>Puddle</h1><button>Run</button></header>
    <input id="field" value="hello" />
    <div contenteditable="true" id="editable">notes</div>
    <div class="ui-selectable" id="answer"><table><tr><td id="cell">42</td></tr></table></div>`;
  remove = blockPageSelectAll();
});
afterEach(() => {
  remove();
  window.getSelection()?.removeAllRanges();
});

/** Press a key on the element, as the browser would, and say whether the page's default (select all) still runs. */
const press = (target: Element, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const byId = (id: string) => document.getElementById(id)!;

describe('select all', () => {
  it('never selects the whole page from the app chrome, with Ctrl or Cmd', () => {
    expect(press(document.body, { key: 'a', ctrlKey: true })).toBe(false);
    expect(press(document.querySelector('button')!, { key: 'a', metaKey: true })).toBe(false);
    expect(press(document.body, { key: 'A', ctrlKey: true })).toBe(false);
    expect(window.getSelection()?.toString()).toBe('');
  });

  it('keeps its usual meaning in a text field or an editable element', () => {
    expect(press(byId('field'), { key: 'a', ctrlKey: true })).toBe(true);
    expect(press(byId('editable'), { key: 'a', metaKey: true })).toBe(true);
  });

  it('selects just the selectable text the selection is in', () => {
    window.getSelection()!.collapse(byId('cell').firstChild!, 0);
    expect(press(document.body, { key: 'a', ctrlKey: true })).toBe(false);
    expect(window.getSelection()?.toString()).toBe('42');
  });

  it('leaves other keys, other combinations and keys a widget already handled alone', () => {
    expect(press(document.body, { key: 'a' })).toBe(true);
    expect(press(document.body, { key: 'a', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(press(document.body, { key: 'c', ctrlKey: true })).toBe(true);
    const grid = document.createElement('div');
    document.body.append(grid);
    grid.addEventListener('keydown', (e) => e.preventDefault());
    expect(press(grid, { key: 'a', ctrlKey: true })).toBe(false);
  });
});
