// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { focusNodeWhenDrawn, keyboardOnCanvas } from './focusNode';

/** Frames run by hand, so a test says when React Flow has drawn the node. */
function frames() {
  let queue: Array<() => void> = [];
  return {
    request: (fn: () => void) => queue.push(fn),
    cancel: () => void (queue = []),
    run(n = 1) {
      for (let i = 0; i < n; i++) {
        const now = queue;
        queue = [];
        for (const fn of now) fn();
      }
    },
    get pending() {
      return queue.length;
    },
  };
}

function page() {
  document.body.innerHTML = `
    <main aria-label="Canvas" tabindex="-1"><div class="puddle-canvas"><div class="flow"></div><button>Zoom in</button></div></main>
    <aside aria-label="Inspector"><input aria-label="Search steps" /></aside>`;
  const main = document.querySelector<HTMLElement>('main')!;
  const flow = document.querySelector<HTMLElement>('.flow')!;
  const search = document.querySelector<HTMLInputElement>('input')!;
  const drawNode = (id: string) => {
    const el = document.createElement('div');
    el.className = 'react-flow__node';
    el.dataset.id = id;
    el.tabIndex = 0;
    flow.append(el);
    return el;
  };
  return { main, search, drawNode, zoom: document.querySelector<HTMLElement>('button')! };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('keyboardOnCanvas', () => {
  it('is true on the canvas or nowhere, and false in the inspector or on a canvas button', () => {
    const p = page();
    expect(keyboardOnCanvas(document.body)).toBe(true);
    expect(keyboardOnCanvas(p.main)).toBe(true);
    expect(keyboardOnCanvas(p.search)).toBe(false);
    expect(keyboardOnCanvas(p.zoom)).toBe(false);
  });
});

describe('focusNodeWhenDrawn', () => {
  it('focuses a node that is already drawn at once', () => {
    const p = page();
    const node = p.drawNode('n1');
    p.main.focus();
    const f = frames();
    focusNodeWhenDrawn('n1', f);
    expect(document.activeElement).toBe(node);
    expect(f.pending).toBe(0);
  });

  it('waits for a node just added to be drawn', () => {
    const p = page();
    p.main.focus();
    const f = frames();
    focusNodeWhenDrawn('n1', f);
    f.run(5);
    expect(document.activeElement).toBe(p.main);
    const node = p.drawNode('n1');
    f.run();
    expect(document.activeElement).toBe(node);
    expect(f.pending).toBe(0);
  });

  // Regression (WebKit): T then / straight away. The new node was drawn a few frames after the step search opened, took
  // the focus from it, and the Enter meant for the search opened the node instead of adding the step.
  it('gives up once the keyboard has gone elsewhere, so a node drawn late never takes the focus back', () => {
    const p = page();
    p.main.focus();
    const f = frames();
    focusNodeWhenDrawn('n1', f);
    f.run(3);
    p.search.focus();
    p.drawNode('n1');
    f.run(5);
    expect(document.activeElement).toBe(p.search);
    expect(f.pending).toBe(0);
  });

  // Regression (WebKit): O then F straight away. F put the keyboard on the canvas itself, which still counts as on the
  // canvas, so the Output node drawn a few frames later took the focus from it and the arrow keys stopped working.
  it('gives up once the keyboard has moved on the canvas too, such as F focusing the canvas itself', () => {
    const p = page();
    p.drawNode('n1').focus();
    const f = frames();
    focusNodeWhenDrawn('n2', f);
    f.run(3);
    p.main.focus();
    p.drawNode('n2');
    f.run(5);
    expect(document.activeElement).toBe(p.main);
    expect(f.pending).toBe(0);
  });

  it('leaves the focus alone when the keyboard is not on the canvas', () => {
    const p = page();
    p.drawNode('n1');
    p.search.focus();
    const f = frames();
    focusNodeWhenDrawn('n1', f);
    expect(document.activeElement).toBe(p.search);
  });

  it('stops trying after about a second, and when cancelled', () => {
    const p = page();
    p.main.focus();
    const f = frames();
    focusNodeWhenDrawn('n1', f);
    f.run(70);
    expect(f.pending).toBe(0);
    const stop = focusNodeWhenDrawn('n2', f);
    stop();
    expect(f.pending).toBe(0);
  });
});
